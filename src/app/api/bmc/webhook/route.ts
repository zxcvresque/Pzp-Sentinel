import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { bmcTransactionKeys, parseBmcWebhook, verifyBmcSignature, type NormalizedBmcEvent } from "@/lib/bmc-webhook";
import { bmcAccountSlug, extractBmcAttributionCode, hashBmcAttributionCode } from "@/lib/bmc-attribution";
import { escapeTelegramHtml } from "@/lib/telegram-format";

const CREATED_EVENTS = new Set([
  "donation.created",
  "extra_purchase.created",
  "commission_order.created",
  "wishlist_payment.created",
  "membership.started",
  "recurring_donation.started",
]);

const REFUND_EVENTS = new Set([
  "donation.refunded",
  "extra_purchase.refunded",
  "commission_order.refunded",
  "wishlist_payment.refunded",
]);

const LIFECYCLE_EVENTS = new Set([
  "extra_purchase.updated",
  "membership.updated",
  "membership.cancelled",
  "membership.paused",
  "recurring_donation.updated",
  "recurring_donation.cancelled",
]);

function symbol(event: NormalizedBmcEvent) {
  return event.currency === "INR" ? "₹" : "$";
}

function eventLabel(type: string) {
  if (type.startsWith("extra_purchase.")) return "Extra purchase";
  if (type.startsWith("commission_order.")) return "Commission order";
  if (type.startsWith("wishlist_payment.")) return "Wishlist payment";
  if (type.startsWith("membership.")) return "Membership";
  if (type.startsWith("recurring_donation.")) return "Monthly support";
  return "Support";
}

function transactionDescription(event: NormalizedBmcEvent) {
  const attributionCode = extractBmcAttributionCode(event.note);
  const publicNote = attributionCode ? event.note?.replace(attributionCode, "").trim() : event.note;
  const note = publicNote ? ` — “${publicNote}”` : "";
  const item = event.itemLabel ? ` · ${event.itemLabel}` : "";
  return `BMC ${eventLabel(event.type)}: ${event.supporterName}${item}${note}`;
}

async function findTransaction(event: NormalizedBmcEvent) {
  const keys = bmcTransactionKeys(event.type, event.resourceId);
  return prisma.transaction.findFirst({ where: { bmcEventId: { in: keys } } });
}

async function createTransaction(event: NormalizedBmcEvent, adminId: string) {
  if (!Number.isFinite(event.amount) || event.amount <= 0) {
    throw new Error(`${event.type} has no positive payment amount`);
  }

  const keys = bmcTransactionKeys(event.type, event.resourceId);
  const [eventId] = keys;
  const accountSlug = bmcAccountSlug();
  const code = event.liveMode ? extractBmcAttributionCode(event.note) : null;

  const result = await prisma.$transaction(async (db) => {
    const existing = await db.transaction.findFirst({
      where: { bmcEventId: { in: keys } },
      include: { fromUser: true },
    });
    if (existing) {
      return {
        transaction: existing,
        duplicate: true,
        attribution: existing.fromUserId ? "ATTRIBUTED" : "UNMATCHED",
      } as const;
    }

    const knownLink = event.liveMode && event.supporterId
      ? await db.bmcSupporterLink.findUnique({
          where: { accountSlug_supporterId: { accountSlug, supporterId: event.supporterId } },
        })
      : null;

    let intent = null;
    if (!knownLink && code) {
      const now = new Date();
      intent = await db.bmcCheckoutIntent.findFirst({
        where: {
          codeHash: hashBmcAttributionCode(code),
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (intent) {
        const claimed = await db.bmcCheckoutIntent.updateMany({
          where: { id: intent.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (claimed.count !== 1) intent = null;
      }
    }

    const fromUserId = knownLink?.userId || intent?.userId || null;
    const transaction = await db.transaction.create({
      data: {
        amount: new Prisma.Decimal(event.amount),
        currency: event.currency,
        method: "BMC",
        direction: "IN",
        type: "DONATION",
        fromUserId,
        description: transactionDescription(event),
        status: "APPROVED",
        isTest: !event.liveMode,
        bmcEventId: eventId,
        date: event.occurredAt,
        createdById: adminId,
      },
      include: { fromUser: true },
    });

    if (knownLink) {
      await db.bmcSupporterLink.update({
        where: { id: knownLink.id },
        data: {
          supporterEmail: event.supporterEmail || knownLink.supporterEmail,
          lastSeenAt: new Date(),
        },
      });
    } else if (intent && event.supporterId) {
      await db.bmcSupporterLink.create({
        data: {
          accountSlug,
          supporterId: event.supporterId,
          supporterEmail: event.supporterEmail,
          userId: intent.userId,
        },
      });
    }
    if (intent) {
      await db.bmcCheckoutIntent.update({
        where: { id: intent.id },
        data: { transactionId: transaction.id },
      });
    }

    return {
      transaction,
      duplicate: false,
      attribution: knownLink ? "SUPPORTER_LINK" : intent ? "CHECKOUT_CODE" : "UNMATCHED",
    } as const;
  });

  if (result.duplicate) return result;
  const transaction = result.transaction;

  const amount = `${symbol(event)}${event.amount.toFixed(2)}`;
  const matchedDonor = transaction.fromUser;
  await notifyAdmins({
    type: "SYSTEM",
    title: result.attribution === "UNMATCHED"
      ? `${event.liveMode ? "Unmatched" : "Test"} BMC ${eventLabel(event.type)}`
      : `${event.liveMode ? "New" : "Test"} BMC ${eventLabel(event.type)}`,
    message: result.attribution === "UNMATCHED"
      ? `${amount} from ${event.supporterName} needs donor attribution.`
      : `${amount} from ${event.supporterName} was attributed to ${matchedDonor?.name}.`,
    entityId: transaction.id,
    actionUrl: "/admin/transactions",
    actionLabel: result.attribution === "UNMATCHED" ? "Reconcile payment" : "View transaction",
    telegramMessage: formatTgMessage(
      result.attribution === "UNMATCHED" ? "BMC payment needs attribution" : "BMC payment captured",
      `${amount} from ${escapeTelegramHtml(event.supporterName)}`,
      result.attribution === "UNMATCHED"
        ? "Open Transactions and assign the correct donor."
        : `Matched to ${escapeTelegramHtml(matchedDonor?.name || "donor")}`,
    ),
  });

  if (matchedDonor && event.liveMode) {
    await notify({
      userId: matchedDonor.id,
      type: "TX_APPROVED",
      title: "BMC donation received — thank you!",
      message: `${amount} was received through Buy Me a Coffee and added to your donation history.`,
      entityId: transaction.id,
      actionUrl: "/donor",
      telegramMessage: formatTgMessage(
        "BMC Donation Received",
        `${amount} received`,
        "It is now linked to your Sentinel account.",
      ),
    });
  }

  scheduleFinanceAutomation({
    action: "CREATED",
    actorName: "Buy Me a Coffee",
    transactionId: transaction.id,
    sendBackup: event.liveMode,
  });
  return result;
}

async function refundTransaction(event: NormalizedBmcEvent) {
  const existing = await findTransaction(event);
  if (!existing) return null;
  const transaction = existing.status === "REJECTED"
    ? existing
    : await prisma.transaction.update({
        where: { id: existing.id },
        data: { status: "REJECTED", reviewNote: "Refunded via Buy Me a Coffee" },
      });

  await notifyAdmins({
    type: "SYSTEM",
    title: `BMC ${eventLabel(event.type)} refunded`,
    message: `${transaction.currency === "INR" ? "₹" : "$"}${transaction.amount} from ${event.supporterName} was refunded`,
    entityId: transaction.id,
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      "↩️ BMC refund",
      `${transaction.currency === "INR" ? "₹" : "$"}${transaction.amount} refunded`,
      `${eventLabel(event.type)} · ${event.supporterName}`,
    ),
  });
  scheduleFinanceAutomation({ action: "UPDATED", actorName: "Buy Me a Coffee", transactionId: transaction.id });
  return transaction;
}

async function notifyLifecycle(event: NormalizedBmcEvent) {
  const state = event.type.split(".").at(-1) || "updated";
  await notifyAdmins({
    type: "SYSTEM",
    title: `BMC ${eventLabel(event.type)} ${state}`,
    message: `${event.supporterName} · ${event.itemLabel || eventLabel(event.type)}`,
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      `BMC ${eventLabel(event.type)}`,
      `${event.supporterName} · ${state}`,
      event.itemLabel || undefined,
    ),
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.BMC_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-sha256")
    || request.headers.get("x-bmc-signature")
    || "";
  if (!verifyBmcSignature(rawBody, signature, secret)) {
    console.warn("[bmc] rejected webhook with invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: NormalizedBmcEvent;
  try {
    event = parseBmcWebhook(rawBody);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload" }, { status: 400 });
  }

  const admin = await prisma.user.findFirst({
    where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
    select: { id: true },
  });
  if (!admin) return NextResponse.json({ error: "No active admin found" }, { status: 503 });

  const existingDelivery = await prisma.bmcWebhookEvent.findUnique({ where: { eventKey: event.eventKey } });
  if (existingDelivery?.processedAt) {
    return NextResponse.json({ status: "duplicate", event: event.type });
  }

  const receipt = existingDelivery
    ? await prisma.bmcWebhookEvent.update({
        where: { id: existingDelivery.id },
        data: {
          attempt: event.attempt,
          status: "PROCESSING",
          supporterId: event.supporterId,
          supporterEmail: event.supporterEmail,
          payload: event.data as Prisma.InputJsonValue,
        },
      })
    : await prisma.bmcWebhookEvent.create({
        data: {
          eventKey: event.eventKey,
          providerEventId: event.providerEventId,
          eventType: event.type,
          liveMode: event.liveMode,
          attempt: event.attempt,
          resourceId: event.resourceId,
          supporterName: event.supporterName,
          supporterId: event.supporterId,
          supporterEmail: event.supporterEmail,
          amount: event.amount > 0 ? new Prisma.Decimal(event.amount) : undefined,
          currency: event.currency,
          payload: event.data as Prisma.InputJsonValue,
        },
      });

  try {
    let transactionId: string | null = null;
    let status = "NOTED";
    let attributionStatus = "NOT_APPLICABLE";

    if (CREATED_EVENTS.has(event.type)) {
      const result = await createTransaction(event, admin.id);
      transactionId = result.transaction.id;
      status = result.duplicate ? "DUPLICATE_RESOURCE" : "CREATED";
      attributionStatus = result.attribution;
    } else if (REFUND_EVENTS.has(event.type)) {
      const transaction = await refundTransaction(event);
      transactionId = transaction?.id || null;
      status = transaction ? "REFUNDED" : "REFUND_UNMATCHED";
      attributionStatus = transaction?.fromUserId ? "ATTRIBUTED" : transaction ? "UNMATCHED" : "NOT_APPLICABLE";
    } else if (LIFECYCLE_EVENTS.has(event.type)) {
      await notifyLifecycle(event);
      const transaction = await findTransaction(event);
      transactionId = transaction?.id || null;
      status = event.type.split(".").at(-1)?.toUpperCase() || "NOTED";
      attributionStatus = transaction?.fromUserId ? "ATTRIBUTED" : transaction ? "UNMATCHED" : "NOT_APPLICABLE";
    } else {
      status = "UNHANDLED";
    }

    await prisma.bmcWebhookEvent.update({
      where: { id: receipt.id },
      data: { status, attributionStatus, transactionId, processedAt: new Date() },
    });
    await logAudit({
      userId: admin.id,
      action: `BMC_${status}`,
      entityType: "BmcWebhookEvent",
      entityId: receipt.id,
      transactionId: transactionId || undefined,
      userName: "Buy Me a Coffee",
      details: `${event.type} · ${event.supporterName}${event.amount ? ` · ${symbol(event)}${event.amount.toFixed(2)}` : ""}${event.liveMode ? "" : " · TEST"}`,
    });

    return NextResponse.json({ status: status.toLowerCase(), event: event.type, transactionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    await prisma.bmcWebhookEvent.update({
      where: { id: receipt.id },
      data: { status: "FAILED", payload: { ...event.data, sentinel_error: message } as Prisma.InputJsonValue },
    }).catch(() => undefined);
    console.error(`[bmc] ${event.type} processing failed:`, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
