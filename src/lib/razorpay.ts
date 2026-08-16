import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { logTransaction } from "@/lib/telegram-log";
import { logTransaction as ghLogTransaction } from "@/lib/github-log";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { dmThanks } from "@/lib/donation-thanks";
import { announceDonationTransaction } from "@/lib/donation-announcement";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { verifyCheckoutHmac, verifySubscriptionHmac, verifyWebhookHmac } from "@/lib/razorpay-signatures";
import { hashInviteToken, INVITE_TOKEN_PATTERN } from "@/lib/invite-token";
import { escapeTelegramHtml, formatTelegramIdentity } from "@/lib/telegram-format";
import { monthlyReminderUpdate } from "@/lib/donation-frequency";
import { encryptSecret } from "@/lib/secret-crypto";
import {
  razorpayFeedbackKeyboard,
  subscriptionAlertPolicy,
  type NormalizedRazorpaySubscriptionEvent,
} from "@/lib/razorpay-subscription-events";

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
  invoice_id?: string | null;
  method?: string;
  vpa?: string;
  wallet?: string;
  bank?: string;
  card?: { network?: string; type?: string; issuer?: string };
  email?: string;
  contact?: string;
  notes?: Record<string, unknown> | string[];
  created_at?: number;
};

type RazorpayPlanResponse = { id: string };

type RazorpaySubscriptionResponse = {
  id: string;
  plan_id: string;
  status: string;
  paid_count?: number;
  total_count: number;
  short_url?: string;
};

type RazorpayInvoiceResponse = {
  id: string;
  subscription_id?: string | null;
};

type RazorpayPaymentCollection = {
  items?: RazorpayPaymentResponse[];
};

function razorpayPaymentDetail(payment: RazorpayPaymentResponse): string | null {
  const method = payment.method?.trim().toLowerCase();
  if (!method) return null;
  if (method === "upi") {
    const handle = payment.vpa?.split("@").at(-1)?.toLowerCase() || "";
    const app = /^(okaxis|okhdfcbank|oksbi|okicici)$/.test(handle) ? "google_pay"
      : /^(ybl|ibl|axl)$/.test(handle) ? "phonepe"
        : handle === "paytm" ? "paytm"
          : handle === "apl" ? "amazon_pay"
            : /mobikwik|ikwik/.test(handle) ? "mobikwik"
              : "upi";
    return `upi:${app}`;
  }
  if (method === "wallet") return `wallet:${payment.wallet?.trim().toLowerCase() || "wallet"}`;
  if (method === "card") return `card:${payment.card?.network?.trim().toLowerCase() || "card"}`;
  if (method === "netbanking") return `netbanking:${payment.bank?.trim().toLowerCase() || "bank"}`;
  return method;
}

function encryptedRazorpayPaymentDetails(payment: RazorpayPaymentResponse) {
  return encryptSecret(JSON.stringify({
    paymentId: payment.id,
    orderId: payment.order_id,
    invoiceId: payment.invoice_id,
    email: payment.email,
    contact: payment.contact,
    method: payment.method,
    vpa: payment.vpa,
    wallet: payment.wallet,
    bank: payment.bank,
    card: payment.card,
    notes: payment.notes,
  }));
}

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

export async function createOneTimeDonationInvite(params: {
  createdById: string;
  guestName: unknown;
  note?: unknown;
  expiresInHours?: unknown;
  allowRazorpay?: unknown;
}) {
  const guestName = typeof params.guestName === "string" ? params.guestName.trim().slice(0, 80) : "";
  const note = typeof params.note === "string" ? params.note.trim().slice(0, 120) : "";
  const expiresInHours = Math.min(Math.max(Number(params.expiresInHours) || 24, 1), 168);
  if (!guestName) {
    throw new RazorpayError("Guest name is required", 400);
  }

  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.oneTimeDonationInvite.create({
    data: {
      tokenHash: hashInviteToken(token),
      guestName,
      note: note || null,
      allowRazorpay: params.allowRazorpay === true,
      createdById: params.createdById,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    },
  });
  return { invite, token };
}

export async function getOneTimeDonationInvite(token: string) {
  if (!INVITE_TOKEN_PATTERN.test(token)) return null;
  return prisma.oneTimeDonationInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { order: { include: { transaction: true } } },
  });
}

function assertInviteAvailable(invite: NonNullable<Awaited<ReturnType<typeof getOneTimeDonationInvite>>>) {
  if (invite.revokedAt) throw new RazorpayError("This one-time payment link was revoked", 410);
  if (invite.usedAt || invite.order?.transaction) throw new RazorpayError("This one-time payment link has already been used", 410);
  if (invite.expiresAt.getTime() <= Date.now()) throw new RazorpayError("This one-time payment link has expired", 410);
  if (!invite.telegramId || !invite.claimedAt) throw new RazorpayError("Open the Telegram bot link to verify your identity first", 403);
}

export async function createGuestDonationOrder(params: {
  token: string;
  amount: unknown;
  description?: unknown;
}) {
  const invite = await getOneTimeDonationInvite(params.token);
  if (!invite) throw new RazorpayError("One-time payment link not found", 404);
  assertInviteAvailable(invite);
  if (!invite.allowRazorpay) {
    throw new RazorpayError("Razorpay is not enabled for this payment invitation", 403);
  }

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
  requireAccess?: boolean;
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
    select: {
      id: true,
      name: true,
      telegramUser: true,
      razorpayAccess: true,
    },
  });
  if (!user) throw new RazorpayError("User not found", 404);

  const config = credentials();
  if (params.requireAccess) {
    if (!user.razorpayAccess) {
      throw new RazorpayError("Razorpay checkout is not currently enabled for your account", 403);
    }
  }

  const note = typeof params.description === "string"
    ? params.description.trim().slice(0, 120)
    : "";
  const description = note || "Donation through Sentinel";
  const receipt = `sentinel_${Date.now()}_${user.id.slice(-6)}`.slice(0, 40);
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

export async function createMonthlyDonationSubscription(params: {
  userId: string;
  amount: unknown;
  description?: unknown;
  requireAccess?: boolean;
}) {
  const amountRupees = typeof params.amount === "number" ? params.amount : Number(params.amount);
  const amount = Math.round(amountRupees * 100);
  if (!Number.isSafeInteger(amount) || amount < MIN_DONATION_PAISE || amount > MAX_DONATION_PAISE) {
    throw new RazorpayError("Enter an amount between ₹1 and ₹10,00,000", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, name: true, razorpayAccess: true },
  });
  if (!user) throw new RazorpayError("User not found", 404);
  if (params.requireAccess && !user.razorpayAccess) {
    throw new RazorpayError("Razorpay checkout is not currently enabled for your account", 403);
  }

  const config = credentials();
  const reusable = await prisma.razorpaySubscription.findFirst({
    where: {
      userId: user.id,
      amount,
      status: "CREATED",
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (reusable) {
    return {
      id: reusable.razorpaySubscriptionId,
      amount: reusable.amount,
      currency: reusable.currency,
      description: reusable.description,
      keyId: config.keyId,
      testMode: config.testMode,
      prefill: { name: user.name },
    };
  }

  const note = typeof params.description === "string" ? params.description.trim().slice(0, 120) : "";
  const description = note || "Monthly donation to Piratezparty";
  // Plans describe only amount + cadence, so donors choosing the same amount
  // can safely share one plan while retaining separate subscriptions/mandates.
  // Keep test and live plans isolated even if their amounts match.
  const existingPlan = await prisma.razorpaySubscription.findFirst({
    where: { amount, currency: "INR", testMode: config.testMode },
    select: { razorpayPlanId: true },
    orderBy: { createdAt: "desc" },
  });
  const planId = existingPlan?.razorpayPlanId || (await razorpayRequest<RazorpayPlanResponse>("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: "PzP monthly support",
        amount,
        currency: "INR",
        description: `Monthly PzP donation · ₹${amountRupees.toLocaleString("en-IN")}`,
      },
      notes: { sentinel_frequency: "monthly", sentinel_amount_paise: String(amount) },
    }),
  })).id;
  const configuredTotal = Number(process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT || 1200);
  const totalCount = Number.isInteger(configuredTotal) ? Math.min(1200, Math.max(1, configuredTotal)) : 1200;
  const remote = await razorpayRequest<RazorpaySubscriptionResponse>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: planId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: true,
      notes: { sentinel_user_id: user.id, sentinel_frequency: "monthly" },
    }),
  });
  const subscription = await prisma.razorpaySubscription.create({
    data: {
      razorpaySubscriptionId: remote.id,
      razorpayPlanId: planId,
      userId: user.id,
      amount,
      currency: "INR",
      description,
      status: remote.status.toUpperCase(),
      totalCount,
      testMode: config.testMode,
    },
  });
  return {
    id: subscription.razorpaySubscriptionId,
    amount: subscription.amount,
    currency: subscription.currency,
    description: subscription.description,
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

function subscriptionAlertCopy(action: string, amount: string) {
  switch (action) {
    case "cancelled":
      return {
        title: "Monthly autopay cancelled",
        donor: `Your ${amount} monthly Razorpay autopay has been cancelled. No future automatic charges will be made.`,
        admin: `The ${amount} monthly Razorpay autopay was cancelled.`,
      };
    case "paused":
      return {
        title: "Monthly autopay paused",
        donor: `Your ${amount} monthly Razorpay autopay has been paused. Automatic charges will remain stopped until it is resumed.`,
        admin: `The ${amount} monthly Razorpay autopay was paused.`,
      };
    case "pending":
      return {
        title: "Monthly autopay needs attention",
        donor: `Razorpay could not complete the scheduled ${amount} charge and may retry automatically. Check the payment-method notification from Razorpay.`,
        admin: `The ${amount} monthly Razorpay autopay is pending.`,
      };
    case "halted":
      return {
        title: "Monthly autopay halted",
        donor: `Razorpay exhausted its retries for your ${amount} monthly autopay. Automatic charging has stopped until the payment method is fixed.`,
        admin: `The ${amount} monthly Razorpay autopay was halted after unsuccessful retries.`,
      };
    case "resumed":
    case "activated":
      return {
        title: "Monthly autopay active",
        donor: `Your ${amount} monthly Razorpay autopay is active and future charges will run automatically.`,
        admin: `The ${amount} monthly Razorpay autopay is active.`,
      };
    case "completed":
      return {
        title: "Monthly autopay completed",
        donor: `Your ${amount} monthly Razorpay autopay completed its scheduled billing cycles.`,
        admin: `The ${amount} monthly Razorpay autopay completed its scheduled billing cycles.`,
      };
    case "expired":
      return {
        title: "Monthly autopay expired",
        donor: `Your ${amount} monthly Razorpay autopay expired before it became active.`,
        admin: `The ${amount} monthly Razorpay autopay expired before activation.`,
      };
    default:
      return null;
  }
}

export async function handleRazorpaySubscriptionLifecycle(event: NormalizedRazorpaySubscriptionEvent) {
  const stored = await prisma.razorpaySubscription.findUnique({
    where: { razorpaySubscriptionId: event.subscriptionId },
    include: { user: true },
  });
  if (!stored) return { matched: false };

  const updated = await prisma.razorpaySubscription.update({
    where: { id: stored.id },
    data: {
      status: event.status,
      ...(event.paidCount !== undefined ? { paidCount: event.paidCount } : {}),
      ...(event.remainingCount !== undefined ? { remainingCount: event.remainingCount } : {}),
      ...(event.nextChargeAt !== undefined ? { nextChargeAt: event.nextChargeAt } : {}),
      ...(event.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
      ...(event.cancelInitiatedBy !== undefined ? { cancelInitiatedBy: event.cancelInitiatedBy } : {}),
      ...(event.pauseInitiatedBy !== undefined ? { pauseInitiatedBy: event.pauseInitiatedBy } : {}),
      lastWebhookEvent: event.event,
      lastWebhookAt: new Date(),
    },
  });

  const initiator = event.cancelInitiatedBy || event.pauseInitiatedBy;
  await logAudit({
    userId: stored.userId,
    action: `RAZORPAY_${event.event.replaceAll(".", "_").toUpperCase()}`,
    entityType: "RazorpaySubscription",
    entityId: stored.id,
    before: { status: stored.status, paidCount: stored.paidCount },
    after: { ...event, status: updated.status },
    userName: "Razorpay webhook",
    details: `${stored.user.name} · ${event.status}${initiator ? ` · initiated by ${initiator}` : ""} · ${stored.razorpaySubscriptionId}`,
  });

  const policy = subscriptionAlertPolicy(event.action);
  const amount = `₹${(stored.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const copy = subscriptionAlertCopy(event.action, amount);
  if (!copy) return { matched: true, subscription: updated };

  let feedbackId: string | null = null;
  if (event.action === "halted" || event.action === "cancelled") {
    const activeFeedback = await prisma.razorpaySubscriptionFeedback.findFirst({
      where: {
        subscriptionId: stored.id,
        stage: { in: ["ASK_WANTED", "ASK_CANCELLED", "AWAITING_REASON"] },
      },
      orderBy: { requestedAt: "desc" },
    });
    if (activeFeedback?.stage === "ASK_WANTED") {
      feedbackId = activeFeedback.id;
    } else if (!activeFeedback) {
      const feedback = await prisma.razorpaySubscriptionFeedback.create({
        data: {
          subscriptionId: stored.id,
          userId: stored.userId,
          triggerAction: event.action.toUpperCase(),
        },
      });
      feedbackId = feedback.id;
    }
  }

  const initiatorSuffix = initiator ? ` Initiated by: ${initiator}.` : "";
  if (policy.donor) {
    const feedbackQuestion = feedbackId
      ? "Did this stop or fail even though you still wanted to continue donating?"
      : undefined;
    await notify({
      userId: stored.userId,
      type: "SYSTEM",
      title: copy.title,
      message: `${copy.donor}${initiatorSuffix}`,
      entityId: stored.id,
      priority: policy.priority,
      actionUrl: "/donor",
      telegramMessage: formatTgMessage(
        copy.title,
        copy.donor,
        [
          initiator ? `Initiated by: ${escapeTelegramHtml(initiator)}` : null,
          feedbackQuestion ? `<b>${feedbackQuestion}</b>` : null,
        ].filter(Boolean).join("\n") || undefined,
      ),
      telegramReplyMarkup: feedbackId ? razorpayFeedbackKeyboard(feedbackId) : undefined,
    });
  }
  if (policy.admins) {
    const adminMessage = `${stored.user.name}: ${copy.admin}${initiatorSuffix}`;
    await notifyAdmins({
      type: "SYSTEM",
      title: copy.title,
      message: adminMessage,
      entityId: stored.id,
      priority: policy.priority,
      actionUrl: "/admin/transactions",
      telegramMessage: formatTgMessage(
        copy.title,
        `${escapeTelegramHtml(stored.user.name)}: ${escapeTelegramHtml(copy.admin)}`,
        initiator ? `Initiated by: ${escapeTelegramHtml(initiator)}` : undefined,
      ),
    });
  }
  return { matched: true, subscription: updated };
}

async function fetchPayment(paymentId: string) {
  return razorpayRequest<RazorpayPaymentResponse>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function verifyMonthlySubscriptionCheckout(params: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
  expectedUserId: string;
}) {
  const stored = await prisma.razorpaySubscription.findFirst({
    where: { razorpaySubscriptionId: params.subscriptionId, userId: params.expectedUserId },
  });
  if (!stored) throw new RazorpayError("Monthly subscription was not found", 404);
  const { keySecret } = credentials();
  if (!verifySubscriptionHmac(stored.razorpaySubscriptionId, params.paymentId, keySecret, params.signature)) {
    throw new RazorpayError("Subscription signature verification failed", 400);
  }
  const remote = await razorpayRequest<RazorpaySubscriptionResponse>(
    `/subscriptions/${encodeURIComponent(stored.razorpaySubscriptionId)}`,
  );
  if (remote.id !== stored.razorpaySubscriptionId || remote.plan_id !== stored.razorpayPlanId) {
    throw new RazorpayError("Subscription details do not match Sentinel records", 400);
  }
  const subscription = await prisma.razorpaySubscription.update({
    where: { id: stored.id },
    data: {
      authorizationPaymentId: params.paymentId,
      status: remote.status.toUpperCase(),
      paidCount: remote.paid_count ?? stored.paidCount,
    },
  });

  // Razorpay can collect the first full plan charge during mandate
  // authentication. That payment is returned directly to Checkout, so record
  // it immediately instead of depending on a later webhook delivery.
  const charge = (remote.paid_count ?? 0) > 0
    ? await finalizeMonthlySubscriptionCharge({
        subscriptionId: stored.razorpaySubscriptionId,
        paymentId: params.paymentId,
        status: remote.status,
        paidCount: remote.paid_count,
      })
    : null;

  return {
    subscription,
    transaction: charge?.transaction ?? null,
    paymentRecorded: Boolean(charge),
    duplicate: charge?.duplicate ?? false,
  };
}

/**
 * Recover a subscription payment delivered only as payment.captured/order.paid.
 * Subscription payments reference a Razorpay invoice rather than a Sentinel
 * one-time order; the invoice is the authoritative subscription mapping.
 */
export async function finalizeMonthlyPaymentByReference(params: {
  paymentId: string;
  invoiceId?: string | null;
}) {
  const payment = await fetchPayment(params.paymentId);
  const invoiceId = params.invoiceId || payment.invoice_id;
  if (!invoiceId) {
    const known = await prisma.razorpaySubscription.findFirst({
      where: { authorizationPaymentId: params.paymentId },
      select: { razorpaySubscriptionId: true, status: true, paidCount: true },
    });
    if (!known) return { matched: false as const };
    const result = await finalizeMonthlySubscriptionCharge({
      subscriptionId: known.razorpaySubscriptionId,
      paymentId: params.paymentId,
      status: known.status,
      paidCount: known.paidCount,
    });
    return { matched: true as const, ...result };
  }

  const invoice = await razorpayRequest<RazorpayInvoiceResponse>(
    `/invoices/${encodeURIComponent(invoiceId)}`,
  );
  if (invoice.id !== invoiceId || !invoice.subscription_id) {
    return { matched: false as const };
  }
  const stored = await prisma.razorpaySubscription.findUnique({
    where: { razorpaySubscriptionId: invoice.subscription_id },
    select: { razorpaySubscriptionId: true },
  });
  if (!stored) return { matched: false as const };
  const result = await finalizeMonthlySubscriptionCharge({
    subscriptionId: stored.razorpaySubscriptionId,
    paymentId: params.paymentId,
  });
  return { matched: true as const, ...result };
}

/**
 * Safety net for webhook outages. Razorpay remains the source of truth: recent
 * captured payments are fetched from its API, invoice-mapped to subscriptions,
 * and passed through the same idempotent finalizer as live webhooks.
 */
export async function reconcileRecentRazorpaySubscriptionPayments(lookbackDays = 35) {
  const since = Math.floor((Date.now() - Math.max(1, lookbackDays) * 86_400_000) / 1000);
  const collection = await razorpayRequest<RazorpayPaymentCollection>(
    `/payments?from=${since}&count=100&skip=0`,
  );
  const payments = (collection.items || []).filter((payment) => payment.status === "captured" && payment.captured);
  let recovered = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Checkout may have stored the authorisation payment before a webhook was
  // delivered. Include those references even if the payments page is delayed.
  const initial = await prisma.razorpaySubscription.findMany({
    where: { paidCount: { gt: 0 }, authorizationPaymentId: { not: null } },
    select: { authorizationPaymentId: true },
  });
  const byId = new Map(payments.map((payment) => [payment.id, payment]));
  for (const subscription of initial) {
    const paymentId = subscription.authorizationPaymentId;
    if (paymentId && !byId.has(paymentId)) {
      byId.set(paymentId, { id: paymentId } as RazorpayPaymentResponse);
    }
  }

  for (const payment of byId.values()) {
    try {
      const existing = await prisma.transaction.findUnique({
        where: { providerPaymentId: payment.id },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const result = await finalizeMonthlyPaymentByReference({
        paymentId: payment.id,
        invoiceId: payment.invoice_id,
      });
      if (result.matched && !result.duplicate) recovered++;
      else skipped++;
    } catch (error) {
      errors.push(`${payment.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { checked: byId.size, recovered, skipped, errors };
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
  const payerTelegramId = stored.user?.telegramId || stored.invite?.telegramId;
  if (!payerTelegramId) throw new RazorpayError("Payer Telegram ID is missing", 500);
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
          paymentMethodDetail: razorpayPaymentDetail(payment),
          providerDetailsEncrypted: encryptedRazorpayPaymentDetails(payment),
          direction: "IN",
          type: "DONATION",
          donationFrequency: stored.donationFrequency,
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
    identityName: payerName,
    identityTelegramUser: payerTelegramUser,
    identityTelegramId: payerTelegramId,
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
      `${symbolAmount} from ${escapeTelegramHtml(payerName)}`,
      formatTelegramIdentity({ username: payerTelegramUser, telegramId: payerTelegramId }),
    ),
  }).catch(() => {});

  if (!stored.testMode) announceDonationTransaction(transaction.id).catch(() => {});
  scheduleFinanceAutomation({
    action: stored.testMode ? "RAZORPAY_TEST_CAPTURED" : "RAZORPAY_CAPTURED",
    actorName,
    transactionId: transaction.id,
    sendBackup: true,
  });

  return { transaction, duplicate: false };
}

export async function finalizeMonthlySubscriptionCharge(params: {
  subscriptionId: string;
  paymentId: string;
  status?: string;
  paidCount?: number;
}) {
  const stored = await prisma.razorpaySubscription.findUnique({
    where: { razorpaySubscriptionId: params.subscriptionId },
    include: { user: true },
  });
  if (!stored) throw new RazorpayError("Monthly subscription was not found", 404);

  const duplicate = await prisma.transaction.findUnique({ where: { providerPaymentId: params.paymentId } });
  if (duplicate) return { transaction: duplicate, duplicate: true };

  const payment = await fetchPayment(params.paymentId);
  if (
    payment.id !== params.paymentId
    || payment.amount !== stored.amount
    || payment.currency !== stored.currency
  ) {
    throw new RazorpayError("Subscription charge does not match Sentinel records", 400);
  }
  if (payment.status !== "captured" || !payment.captured) {
    throw new RazorpayError("Subscription charge is not captured", 409);
  }

  const donatedAt = payment.created_at ? new Date(payment.created_at * 1000) : new Date();
  const amount = (stored.amount / 100).toFixed(2);
  let transaction;
  try {
    transaction = await prisma.$transaction(async (db) => {
      const existing = await db.transaction.findUnique({ where: { providerPaymentId: payment.id } });
      if (existing) return existing;
      const created = await db.transaction.create({
        data: {
          amount,
          currency: stored.currency,
          method: "RAZORPAY",
          paymentMethodDetail: razorpayPaymentDetail(payment),
          providerDetailsEncrypted: encryptedRazorpayPaymentDetails(payment),
          direction: "IN",
          type: "DONATION",
          donationFrequency: "MONTHLY",
          providerPaymentId: payment.id,
          razorpaySubscriptionId: stored.razorpaySubscriptionId,
          fromUserId: stored.userId,
          description: `${stored.testMode ? "[TEST] " : ""}${stored.description} · Monthly autopay · ${payment.id}`,
          date: donatedAt,
          status: "APPROVED",
          isTest: stored.testMode,
          createdById: stored.userId,
        },
      });
      await db.razorpaySubscription.update({
        where: { id: stored.id },
        data: {
          status: (params.status || "ACTIVE").toUpperCase(),
          paidCount: Number.isInteger(params.paidCount) ? params.paidCount : { increment: 1 },
        },
      });
      await db.user.update({
        where: { id: stored.userId },
        data: monthlyReminderUpdate("MONTHLY", donatedAt)!,
      });
      return created;
    });
  } catch (error) {
    const existing = await prisma.transaction.findUnique({ where: { providerPaymentId: payment.id } });
    if (existing) return { transaction: existing, duplicate: true };
    throw error;
  }

  const symbolAmount = `₹${Number(amount).toLocaleString("en-IN")}`;
  await logAudit({
    userId: stored.userId,
    action: "RAZORPAY_SUBSCRIPTION_CHARGED",
    entityType: "Transaction",
    entityId: transaction.id,
    transactionId: transaction.id,
    after: transaction,
    userName: "Razorpay subscription webhook",
    details: `${stored.testMode ? "TEST " : ""}${symbolAmount} · ${payment.id} · ${stored.razorpaySubscriptionId}`,
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
    identityName: stored.user.name,
    identityTelegramUser: stored.user.telegramUser,
    identityTelegramId: stored.user.telegramId,
    createdByName: "Razorpay autopay",
  });
  ghLogTransaction({
    action: "RAZORPAY_CAPTURED",
    userId: stored.userId,
    userName: stored.user.name,
    amount,
    currency: stored.currency,
    direction: "IN",
    method: "RAZORPAY",
    entityId: transaction.id,
    details: `Monthly autopay · ${payment.id}`,
  });

  if (!stored.testMode) {
    await notify({
      userId: stored.userId,
      type: "TX_APPROVED",
      title: "Monthly donation received — thank you!",
      message: `${symbolAmount} was collected securely through Razorpay autopay.`,
      entityId: transaction.id,
      actionUrl: "/donor",
      telegramMessage: dmThanks(stored.user.name, Number(amount), stored.currency),
    });
    await announceDonationTransaction(transaction.id);
  }
  notifyAdmins({
    type: "SYSTEM",
    title: stored.testMode ? "Razorpay test subscription charged" : "Razorpay monthly donation captured",
    message: `${stored.user.name} paid ${symbolAmount} by monthly autopay.`,
    entityId: transaction.id,
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      stored.testMode ? "Razorpay Test Subscription Charged" : "Razorpay Monthly Donation Captured",
      `${escapeTelegramHtml(stored.user.name)} paid ${symbolAmount} by monthly autopay.`,
      payment.id,
    ),
  }).catch(() => {});
  scheduleFinanceAutomation({
    action: stored.testMode ? "RAZORPAY_TEST_CAPTURED" : "RAZORPAY_CAPTURED",
    actorName: "Razorpay subscription webhook",
    transactionId: transaction.id,
    sendBackup: true,
  });
  return { transaction, duplicate: false };
}
