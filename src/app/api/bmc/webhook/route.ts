import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { bmcTransactionKeys, parseBmcWebhook, verifyBmcSignature, type NormalizedBmcEvent } from "@/lib/bmc-webhook";

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
  const note = event.note ? ` — “${event.note}”` : "";
  const item = event.itemLabel ? ` · ${event.itemLabel}` : "";
  return `BMC ${eventLabel(event.type)}: ${event.supporterName}${item}${note}`;
}

async function findTransaction(event: NormalizedBmcEvent) {
  const keys = bmcTransactionKeys(event.type, event.resourceId);
  return prisma.transaction.findFirst({ where: { bmcEventId: { in: keys } } });
}

async function createTransaction(event: NormalizedBmcEvent, adminId: string) {
  const existing = await findTransaction(event);
  if (existing) return { transaction: existing, duplicate: true };
  if (!Number.isFinite(event.amount) || event.amount <= 0) {
    throw new Error(`${event.type} has no positive payment amount`);
  }

  const [eventId] = bmcTransactionKeys(event.type, event.resourceId);
  const transaction = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal(event.amount),
      currency: event.currency,
      method: "BMC",
      direction: "IN",
      type: "DONATION",
      description: transactionDescription(event),
      status: "APPROVED",
      isTest: !event.liveMode,
      bmcEventId: eventId,
      date: event.occurredAt,
      createdById: adminId,
    },
  });

  const amount = `${symbol(event)}${event.amount.toFixed(2)}`;
  await notifyAdmins({
    type: "SYSTEM",
    title: `${event.liveMode ? "New" : "Test"} BMC ${eventLabel(event.type)}`,
    message: `${amount} from ${event.supporterName}${event.itemLabel ? ` · ${event.itemLabel}` : ""}`,
    entityId: transaction.id,
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      `☕ ${event.liveMode ? "BMC payment captured" : "BMC test captured"}`,
      `${amount} from ${event.supporterName}`,
      `${eventLabel(event.type)}${event.itemLabel ? ` · ${event.itemLabel}` : ""}`,
    ),
  });

  scheduleFinanceAutomation({
    action: "CREATED",
    actorName: "Buy Me a Coffee",
    transactionId: transaction.id,
    sendBackup: event.liveMode,
  });
  return { transaction, duplicate: false };
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
        data: { attempt: event.attempt, status: "PROCESSING", payload: event.data as Prisma.InputJsonValue },
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
          amount: event.amount > 0 ? new Prisma.Decimal(event.amount) : undefined,
          currency: event.currency,
          payload: event.data as Prisma.InputJsonValue,
        },
      });

  try {
    let transactionId: string | null = null;
    let status = "NOTED";

    if (CREATED_EVENTS.has(event.type)) {
      const result = await createTransaction(event, admin.id);
      transactionId = result.transaction.id;
      status = result.duplicate ? "DUPLICATE_RESOURCE" : "CREATED";
    } else if (REFUND_EVENTS.has(event.type)) {
      const transaction = await refundTransaction(event);
      transactionId = transaction?.id || null;
      status = transaction ? "REFUNDED" : "REFUND_UNMATCHED";
    } else if (LIFECYCLE_EVENTS.has(event.type)) {
      await notifyLifecycle(event);
      const transaction = await findTransaction(event);
      transactionId = transaction?.id || null;
      status = event.type.split(".").at(-1)?.toUpperCase() || "NOTED";
    } else {
      status = "UNHANDLED";
    }

    await prisma.bmcWebhookEvent.update({
      where: { id: receipt.id },
      data: { status, transactionId, processedAt: new Date() },
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
