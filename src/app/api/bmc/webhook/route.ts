import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import {
  bmcTransactionKeys,
  parseBmcWebhook,
  verifyBmcRecoverySignature,
  verifyBmcSignature,
  type NormalizedBmcEvent,
} from "@/lib/bmc-webhook";
import { bmcAccountSlug, extractBmcAttributionCode, hashBmcAttributionCode } from "@/lib/bmc-attribution";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { logTransaction } from "@/lib/telegram-log";
import { dmThanks } from "@/lib/donation-thanks";
import { announceDonationTransaction } from "@/lib/donation-announcement";
import { monthlyReminderUpdate } from "@/lib/donation-frequency";
import {
  bmcFeedbackKeyboard,
  isBmcCancellationEvent,
  shouldPromptBmcDonor,
} from "@/lib/bmc-subscription-feedback";
import { encryptSecret } from "@/lib/secret-crypto";

const CREATED_EVENTS = new Set([
  "donation.created",
  "extra_purchase.created",
  "commission_order.created",
  "wishlist_payment.created",
  "membership.started",
  "recurring_donation.started",
  "recurring_donation.updated",
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
  const item = event.itemLabel ? ` · ${event.itemLabel}` : "";
  return `BMC ${eventLabel(event.type)}${item}`;
}

function encryptedBmcDetails(event: NormalizedBmcEvent) {
  return encryptSecret(JSON.stringify({
    supporterName: event.supporterName,
    supporterEmail: event.supporterEmail,
    supporterId: event.supporterId,
    note: event.note,
    itemLabel: event.itemLabel,
    providerEventId: event.providerEventId,
    resourceId: event.resourceId,
  }));
}

async function findTransaction(event: NormalizedBmcEvent) {
  const keys = bmcTransactionKeys(event.type, event.resourceId);
  return prisma.transaction.findFirst({
    where: { bmcEventId: { in: keys } },
    include: { fromUser: true },
  });
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
      intent = await db.bmcCheckoutIntent.findFirst({
        where: {
          codeHash: hashBmcAttributionCode(code),
          consumedAt: null,
          createdAt: { lte: event.occurredAt },
          expiresAt: { gte: event.occurredAt },
        },
      });
      if (intent) {
        const claimed = await db.bmcCheckoutIntent.updateMany({
          where: {
            id: intent.id,
            consumedAt: null,
            createdAt: { lte: event.occurredAt },
            expiresAt: { gte: event.occurredAt },
          },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) intent = null;
      }
    }

    const fromUserId = knownLink?.userId || intent?.userId || null;
    const donationFrequency = event.type.startsWith("recurring_donation.") || event.type.startsWith("membership.")
      ? "MONTHLY"
      : "ONE_TIME";
    const transaction = await db.transaction.create({
      data: {
        amount: new Prisma.Decimal(event.amount),
        currency: event.currency,
        method: "BMC",
        direction: "IN",
        type: "DONATION",
        donationFrequency,
        providerDetailsEncrypted: encryptedBmcDetails(event),
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
          supporterEmail: null,
          supporterDetailsEncrypted: encryptedBmcDetails(event),
          lastSeenAt: new Date(),
          donationFrequency,
        },
      });
    } else if (intent && event.supporterId) {
      await db.bmcSupporterLink.create({
        data: {
          accountSlug,
          supporterId: event.supporterId,
          supporterEmail: null,
          supporterDetailsEncrypted: encryptedBmcDetails(event),
          userId: intent.userId,
          donationFrequency,
        },
      });
    }
    if (intent) {
      await db.bmcCheckoutIntent.update({
        where: { id: intent.id },
        data: { transactionId: transaction.id },
      });
    }
    if (fromUserId) {
      const reminderUpdate = monthlyReminderUpdate(donationFrequency, event.occurredAt);
      if (reminderUpdate) await db.user.update({ where: { id: fromUserId }, data: reminderUpdate });
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
      telegramMessage: dmThanks(matchedDonor.name, event.amount, event.currency),
    });
  }

  if (event.liveMode) await announceDonationTransaction(transaction.id);

  logTransaction({
    id: transaction.id,
    amount: transaction.amount,
    currency: transaction.currency,
    method: transaction.method,
    direction: transaction.direction,
    type: transaction.type,
    description: transaction.description,
    status: transaction.status,
    identityName: matchedDonor?.name || event.supporterName,
    identityTelegramUser: matchedDonor?.telegramUser,
    identityTelegramId: matchedDonor?.telegramId || event.supporterId || "BMC",
    createdByName: "Buy Me a Coffee",
  });

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

async function notifyLifecycle(event: NormalizedBmcEvent, transaction: Awaited<ReturnType<typeof findTransaction>>) {
  const state = event.type.split(".").at(-1) || "updated";
  const cancellation = isBmcCancellationEvent(event.type);
  const supporterLink = !transaction?.fromUser && event.supporterId
    ? await prisma.bmcSupporterLink.findUnique({
        where: {
          accountSlug_supporterId: {
            accountSlug: bmcAccountSlug(),
            supporterId: event.supporterId,
          },
        },
        include: { user: true },
      })
    : null;
  const donor = transaction?.fromUser || supporterLink?.user || null;
  await notifyAdmins({
    type: "SYSTEM",
    title: `${event.liveMode ? "BMC" : "Test BMC"} ${eventLabel(event.type)} ${state}`,
    message: `${event.supporterName} · ${event.itemLabel || eventLabel(event.type)}${donor ? ` · linked to ${donor.name}` : " · donor unidentified"}`,
    priority: cancellation ? "HIGH" : "NORMAL",
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage(
      `BMC ${eventLabel(event.type)}`,
      `${event.supporterName} · ${state}`,
      donor ? `Linked to ${escapeTelegramHtml(donor.name)}` : "Donor unidentified; private follow-up unavailable.",
    ),
  });

  if (!shouldPromptBmcDonor(event.type, event.liveMode, donor?.id) || !donor) return;
  const amount = event.amount > 0
    ? new Prisma.Decimal(event.amount)
    : transaction?.amount ?? null;
  const currency = transaction?.currency || event.currency;
  const feedback = await prisma.bmcSubscriptionFeedback.upsert({
    where: { eventKey: event.eventKey },
    create: {
      eventKey: event.eventKey,
      userId: donor.id,
      supporterId: event.supporterId,
      supporterName: event.supporterName,
      triggerType: event.type,
      amount,
      currency,
    },
    update: {},
  });
  if (feedback.stage !== "ASK_WANTED") return;
  const label = event.type.startsWith("membership.") ? "membership" : "monthly support";
  const question = "Did this stop even though you still wanted to continue donating?";
  await notify({
    userId: donor.id,
    type: "SYSTEM",
    title: `BMC ${label} cancelled`,
    message: `Buy Me a Coffee reported that your ${label} was cancelled. ${question}`,
    entityId: feedback.id,
    priority: "HIGH",
    telegramMessage: formatTgMessage(
      `BMC ${label} cancelled`,
      `Buy Me a Coffee reported that your ${label} was cancelled.`,
      `<b>${question}</b>`,
    ),
    telegramReplyMarkup: bmcFeedbackKeyboard(feedback.id),
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.BMC_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-sha256")
    || request.headers.get("x-bmc-signature")
    || "";
  const providerSignatureValid = verifyBmcSignature(rawBody, signature, secret);
  const recoverySignature = request.headers.get("x-sentinel-bmc-recovery-sha256") || "";
  const operatorRecovery = !providerSignatureValid
    && verifyBmcRecoverySignature(rawBody, recoverySignature, secret);
  if (!providerSignatureValid && !operatorRecovery) {
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
          status: operatorRecovery ? "RECOVERY_PROCESSING" : "PROCESSING",
          supporterId: event.supporterId,
          supporterName: null,
          supporterEmail: null,
          payload: Prisma.DbNull,
          encryptedPayload: encryptSecret(rawBody),
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
          supporterName: null,
          supporterId: event.supporterId,
          supporterEmail: null,
          amount: event.amount > 0 ? new Prisma.Decimal(event.amount) : undefined,
          currency: event.currency,
          payload: Prisma.DbNull,
          encryptedPayload: encryptSecret(rawBody),
          status: operatorRecovery ? "RECOVERY_PROCESSING" : "PROCESSING",
        },
      });

  try {
    let transactionId: string | null = null;
    let status = "NOTED";
    let attributionStatus = "NOT_APPLICABLE";

    if (CREATED_EVENTS.has(event.type) && event.amount > 0) {
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
      const transaction = await findTransaction(event);
      await notifyLifecycle(event, transaction);
      transactionId = transaction?.id || null;
      status = event.type.split(".").at(-1)?.toUpperCase() || "NOTED";
      attributionStatus = transaction?.fromUserId ? "ATTRIBUTED" : transaction ? "UNMATCHED" : "NOT_APPLICABLE";
    } else {
      status = "UNHANDLED";
    }

    const storedStatus = operatorRecovery ? `RECOVERED_${status}` : status;
    await prisma.bmcWebhookEvent.update({
      where: { id: receipt.id },
      data: { status: storedStatus, attributionStatus, transactionId, processedAt: new Date() },
    });
    await logAudit({
      userId: admin.id,
      action: operatorRecovery ? `BMC_FAILED_DELIVERY_${status}` : `BMC_${status}`,
      entityType: "BmcWebhookEvent",
      entityId: receipt.id,
      transactionId: transactionId || undefined,
      userName: operatorRecovery ? "Sentinel operator recovery" : "Buy Me a Coffee",
      details: `${event.type}${event.amount ? ` · ${symbol(event)}${event.amount.toFixed(2)}` : ""}${event.liveMode ? "" : " · TEST"}${operatorRecovery ? " · recovered from BMC failed-delivery log; provider signature unavailable because Cloudflare rejected the original request" : ""}`,
    });

    return NextResponse.json({
      status: storedStatus.toLowerCase(),
      event: event.type,
      transactionId,
      verification: operatorRecovery ? "operator_recovery" : "provider_signature",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    await prisma.bmcWebhookEvent.update({
      where: { id: receipt.id },
      data: {
        status: operatorRecovery ? "RECOVERED_FAILED" : "FAILED",
        payload: Prisma.DbNull,
        encryptedPayload: encryptSecret(JSON.stringify({ ...event.data, sentinel_error: message })),
      },
    }).catch(() => undefined);
    console.error(`[bmc] ${event.type} processing failed:`, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
