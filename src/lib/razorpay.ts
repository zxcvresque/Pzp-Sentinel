import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { logTransaction, postDonationThanks } from "@/lib/telegram-log";
import { logTransaction as ghLogTransaction } from "@/lib/github-log";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { groupThanks, donorHandle, dmThanks } from "@/lib/donation-thanks";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { verifyCheckoutHmac, verifyWebhookHmac } from "@/lib/razorpay-signatures";
import { normalizeTelegramUsername, resolveRegisteredTelegramUser } from "@/lib/telegram-identity";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const MIN_DONATION_PAISE = 100;
const MAX_DONATION_PAISE = 100_000_000;

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

type RazorpayPaymentResponse = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  order_id: string;
  method?: string;
  created_at?: number;
};

export class RazorpayError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
    this.name = "RazorpayError";
  }
}

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new RazorpayError("Razorpay is not configured", 503);
  }
  return { keyId, keySecret, testMode: keyId.startsWith("rzp_test_") };
}

function basicAuth() {
  const { keyId, keySecret } = credentials();
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function razorpayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const payload = await response.json().catch(() => null) as
    | { error?: { description?: string } }
    | T
    | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? payload.error?.description
      : undefined;
    throw new RazorpayError(message || "Razorpay request failed", 502);
  }
  return payload as T;
}

export function razorpayPublicConfig() {
  const { keyId, testMode } = credentials();
  return { keyId, testMode };
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createOneTimeDonationInvite(params: {
  createdById: string;
  guestName: unknown;
  telegramUser: unknown;
  telegramId: unknown;
  note?: unknown;
  expiresInHours?: unknown;
}) {
  const guestName = typeof params.guestName === "string" ? params.guestName.trim().slice(0, 80) : "";
  const telegramUser = normalizeTelegramUsername(params.telegramUser);
  let telegramId = typeof params.telegramId === "string" ? params.telegramId.trim().slice(0, 32) : "";
  const note = typeof params.note === "string" ? params.note.trim().slice(0, 120) : "";
  const expiresInHours = Math.min(Math.max(Number(params.expiresInHours) || 24, 1), 168);
  if (!guestName) {
    throw new RazorpayError("Guest name is required", 400);
  }

  const registeredUser = telegramUser
    ? await resolveRegisteredTelegramUser(telegramUser)
    : null;
  if (registeredUser && telegramId && registeredUser.telegramId !== telegramId) {
    throw new RazorpayError("The Telegram numeric ID does not match the registered username", 400);
  }
  if (registeredUser && !telegramId) telegramId = registeredUser.telegramId;
  if (!/^\d{5,20}$/.test(telegramId)) {
    throw new RazorpayError("A valid Telegram numeric ID is required. Registered Sentinel usernames can be resolved automatically.", 400);
  }

  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.oneTimeDonationInvite.create({
    data: {
      tokenHash: hashInviteToken(token),
      guestName,
      telegramUser: registeredUser?.telegramUser || telegramUser || null,
      telegramId,
      note: note || null,
      createdById: params.createdById,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    },
  });
  return { invite, token };
}

export async function getOneTimeDonationInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return prisma.oneTimeDonationInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { order: { include: { transaction: true } } },
  });
}

function assertInviteAvailable(invite: NonNullable<Awaited<ReturnType<typeof getOneTimeDonationInvite>>>) {
  if (invite.revokedAt) throw new RazorpayError("This one-time payment link was revoked", 410);
  if (invite.usedAt || invite.order?.transaction) throw new RazorpayError("This one-time payment link has already been used", 410);
  if (invite.expiresAt.getTime() <= Date.now()) throw new RazorpayError("This one-time payment link has expired", 410);
}

export async function createGuestDonationOrder(params: {
  token: string;
  amount: unknown;
  description?: unknown;
}) {
  const invite = await getOneTimeDonationInvite(params.token);
  if (!invite) throw new RazorpayError("One-time payment link not found", 404);
  assertInviteAvailable(invite);

  if (invite.order) {
    const config = credentials();
    return {
      id: invite.order.razorpayOrderId,
      amount: invite.order.amount,
      currency: invite.order.currency,
      description: invite.order.description,
      keyId: config.keyId,
      testMode: config.testMode,
      prefill: { name: invite.guestName },
    };
  }

  const amountRupees = typeof params.amount === "number" ? params.amount : Number(params.amount);
  const amount = Math.round(amountRupees * 100);
  if (!Number.isSafeInteger(amount) || amount < MIN_DONATION_PAISE || amount > MAX_DONATION_PAISE) {
    throw new RazorpayError("Enter an amount between ₹1 and ₹10,00,000", 400);
  }
  const suppliedNote = typeof params.description === "string" ? params.description.trim().slice(0, 120) : "";
  const description = suppliedNote || invite.note || `One-time donation from ${invite.guestName}`;
  const receipt = `guest_${Date.now()}_${invite.id.slice(-6)}`.slice(0, 40);
  const config = credentials();
  const remote = await razorpayRequest<RazorpayOrderResponse>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt,
      notes: { sentinel_invite_id: invite.id, telegram_id: invite.telegramId },
    }),
  });
  const order = await prisma.razorpayOrder.create({
    data: {
      razorpayOrderId: remote.id,
      receipt,
      inviteId: invite.id,
      amount,
      currency: "INR",
      description,
      testMode: config.testMode,
    },
  });
  return {
    id: order.razorpayOrderId,
    amount: order.amount,
    currency: order.currency,
    description: order.description,
    keyId: config.keyId,
    testMode: config.testMode,
    prefill: { name: invite.guestName },
  };
}

export async function createDonationOrder(params: {
  userId: string;
  amount: unknown;
  description?: unknown;
}) {
  const amountRupees = typeof params.amount === "number"
    ? params.amount
    : Number(params.amount);
  const amount = Math.round(amountRupees * 100);
  if (!Number.isSafeInteger(amount) || amount < MIN_DONATION_PAISE || amount > MAX_DONATION_PAISE) {
    throw new RazorpayError("Enter an amount between ₹1 and ₹10,00,000", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, name: true, telegramUser: true },
  });
  if (!user) throw new RazorpayError("User not found", 404);

  const note = typeof params.description === "string"
    ? params.description.trim().slice(0, 120)
    : "";
  const description = note || "Donation through Sentinel";
  const receipt = `sentinel_${Date.now()}_${user.id.slice(-6)}`.slice(0, 40);
  const config = credentials();
  const remote = await razorpayRequest<RazorpayOrderResponse>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt,
      notes: {
        sentinel_user_id: user.id,
        sentinel_source: "dashboard",
      },
    }),
  });

  const order = await prisma.razorpayOrder.create({
    data: {
      razorpayOrderId: remote.id,
      receipt,
      userId: user.id,
      amount,
      currency: "INR",
      description,
      testMode: config.testMode,
    },
  });

  return {
    id: order.razorpayOrderId,
    amount: order.amount,
    currency: order.currency,
    description: order.description,
    keyId: config.keyId,
    testMode: config.testMode,
    prefill: { name: user.name },
  };
}

export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  const { keySecret } = credentials();
  return verifyCheckoutHmac(params.orderId, params.paymentId, keySecret, params.signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) throw new RazorpayError("Razorpay webhook secret is not configured", 503);
  return verifyWebhookHmac(rawBody, secret, signature);
}

async function fetchPayment(paymentId: string) {
  return razorpayRequest<RazorpayPaymentResponse>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function finalizeCapturedDonation(params: {
  orderId: string;
  paymentId: string;
  expectedUserId?: string;
  actorName?: string;
}) {
  const stored = await prisma.razorpayOrder.findUnique({
    where: { razorpayOrderId: params.orderId },
    include: { user: true, transaction: true, invite: { include: { createdBy: true } } },
  });
  if (!stored || (params.expectedUserId && stored.userId !== params.expectedUserId)) {
    throw new RazorpayError("Payment order was not found", 404);
  }
  if (stored.transaction) return { transaction: stored.transaction, duplicate: true };

  const payment = await fetchPayment(params.paymentId);
  if (
    payment.id !== params.paymentId
    || payment.order_id !== stored.razorpayOrderId
    || payment.amount !== stored.amount
    || payment.currency !== stored.currency
  ) {
    throw new RazorpayError("Payment details do not match the Sentinel order", 400);
  }
  if (payment.status !== "captured" || !payment.captured) {
    throw new RazorpayError("Payment is authorised but not captured yet", 409);
  }

  const amount = (stored.amount / 100).toFixed(2);
  const payerName = stored.user?.name || stored.invite?.guestName || "Guest donor";
  const payerTelegramUser = stored.user?.telegramUser || stored.invite?.telegramUser;
  const creatorId = stored.userId || stored.invite?.createdById;
  if (!creatorId) throw new RazorpayError("Payment order has no valid owner", 500);
  let transaction;
  try {
    transaction = await prisma.$transaction(async (db) => {
      const latest = await db.razorpayOrder.findUnique({
        where: { id: stored.id },
        include: { transaction: true },
      });
      if (latest?.transaction) return latest.transaction;
      if (stored.inviteId) {
        const availableInvite = await db.oneTimeDonationInvite.findFirst({
          where: { id: stored.inviteId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        });
        if (!availableInvite) throw new Error("One-time payment link is no longer available");
      }

      const created = await db.transaction.create({
        data: {
          amount,
          currency: stored.currency,
          method: "RAZORPAY",
          direction: "IN",
          type: "DONATION",
          fromUserId: stored.userId,
          description: `${stored.testMode ? "[TEST] " : ""}${stored.description}${stored.invite ? `${stored.invite.telegramUser ? ` · @${stored.invite.telegramUser}` : ""} · TG ${stored.invite.telegramId}` : ""} · ${payment.id}`,
          date: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
          status: "APPROVED",
          isTest: stored.testMode,
          createdById: creatorId,
        },
      });
      const claimed = await db.razorpayOrder.updateMany({
        where: { id: stored.id, status: "CREATED", transactionId: null },
        data: {
          paymentId: payment.id,
          transactionId: created.id,
          status: "PAID",
          paidAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new Error("Razorpay order was finalised concurrently");
      if (stored.inviteId) {
        await db.oneTimeDonationInvite.update({ where: { id: stored.inviteId }, data: { usedAt: new Date() } });
      }
      return created;
    });
  } catch (error) {
    const existing = await prisma.razorpayOrder.findUnique({
      where: { razorpayOrderId: params.orderId },
      include: { transaction: true },
    });
    if (existing?.transaction) return { transaction: existing.transaction, duplicate: true };
    throw error;
  }

  const actorName = params.actorName || stored.user?.name || stored.invite?.createdBy.name || payerName;
  await logAudit({
    userId: creatorId,
    action: "RAZORPAY_CAPTURED",
    entityType: "Transaction",
    entityId: transaction.id,
    transactionId: transaction.id,
    after: transaction,
    userName: actorName,
    details: `${stored.testMode ? "TEST " : ""}IN INR ${amount} · ${payment.id}`,
  });
  logTransaction({
    id: transaction.id,
    amount: transaction.amount,
    currency: transaction.currency,
    method: transaction.method,
    direction: transaction.direction,
    type: transaction.type,
    description: transaction.description,
    status: transaction.status,
    fromUserName: payerName,
    createdByName: actorName,
  });
  ghLogTransaction({
    action: "RAZORPAY_CAPTURED",
    userId: creatorId,
    userName: actorName,
    amount,
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: transaction.id,
    details: `${stored.testMode ? "TEST · " : ""}${payment.id}`,
  });

  const symbolAmount = `₹${Number(amount).toLocaleString("en-IN")}`;
  if (stored.userId && stored.user) {
    notify({
      userId: stored.userId,
      type: "TX_APPROVED",
      title: stored.testMode ? "Test payment verified" : "Donation received — thank you!",
      message: `${symbolAmount} was captured securely through Razorpay.`,
      entityId: transaction.id,
      actionUrl: "/donor",
      telegramMessage: stored.testMode
        ? formatTgMessage("Razorpay Test Payment", `${symbolAmount} captured`, payment.id)
        : dmThanks(stored.user.name, Number(amount), "INR"),
    }).catch(() => {});
  }
  notifyAdmins({
    type: "SYSTEM",
    title: stored.testMode ? "Razorpay test captured" : "Razorpay donation captured",
    message: `${payerName} paid ${symbolAmount}. It was verified and recorded automatically.`,
    entityId: transaction.id,
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      stored.testMode ? "Razorpay Test Captured" : "Razorpay Donation Captured",
      `${symbolAmount} from ${payerName}`,
      `${payerTelegramUser ? `@${payerTelegramUser}\n` : ""}<code>${payment.id}</code>`,
    ),
  }).catch(() => {});

  if (!stored.testMode) {
    const handle = donorHandle(payerName, payerTelegramUser);
    postDonationThanks(groupThanks(handle, Number(amount), "INR")).catch(() => {});
  }
  scheduleFinanceAutomation({
    action: stored.testMode ? "RAZORPAY_TEST_CAPTURED" : "RAZORPAY_CAPTURED",
    actorName,
    transactionId: transaction.id,
    sendBackup: true,
  });

  return { transaction, duplicate: false };
}
