import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransaction } from "@/lib/github-log";
import { Prisma } from "@/generated/prisma/client";
import { logTransactionMutation } from "@/lib/telegram-log";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { bmcAccountSlug } from "@/lib/bmc-attribution";
import { notify, formatTgMessage } from "@/lib/notifications";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { serviceReminderRepeat } from "@/lib/service-templates";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { parseBmcWebhook } from "@/lib/bmc-webhook";
import { parseDonationFrequency } from "@/lib/donation-frequency";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { amount, currency, direction, type, method, description, date, fromUserId, attachments, serviceId, createService, confirmReviewedEdit, donationFrequency } = body;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  const isAdmin = hasRole(user.roles, "ADMIN");
  const donorOwnsPending = hasRole(user.roles, "DONOR")
    && (transaction.fromUserId === user.id || transaction.createdById === user.id)
    && transaction.status === "PENDING"
    && !transaction.providerVerified
    && !transaction.voidedAt;
  if (!isAdmin && !donorOwnsPending) return NextResponse.json({ error: "Only an admin or the owner of a pending manual submission may edit it" }, { status: 403 });
  if (!isAdmin) {
    const allowed = new Set(["amount", "currency", "method", "description", "date", "attachments", "donationFrequency"]);
    const invalid = Object.keys(body).filter((key) => !allowed.has(key));
    if (invalid.length) return NextResponse.json({ error: `Donors cannot edit: ${invalid.join(", ")}` }, { status: 400 });
  }

  // Validate amount if provided
  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
  }

  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Voided transactions cannot be edited" }, { status: 400 });
  }
  if (transaction.status !== "PENDING" && confirmReviewedEdit !== true) {
    return NextResponse.json(
      { error: "Editing a reviewed transaction requires explicit confirmation" },
      { status: 409 },
    );
  }

  if (currency !== undefined && !["INR", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (direction !== undefined && !["IN", "OUT"].includes(direction)) {
    return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  }
  if (type !== undefined && !["DONATION", "EXPENSE", "SUBSCRIPTION", "OTHER"].includes(type)) {
    return NextResponse.json({ error: "Invalid transaction type" }, { status: 400 });
  }
  if (method !== undefined && !["UPI", "RAZORPAY", "BMC", "BANK", "OTHER"].includes(method)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }
  if (method !== undefined && ["RAZORPAY", "BMC"].includes(method) && !transaction.providerVerified) {
    return NextResponse.json({ error: "Provider methods can only come from a verified provider payment" }, { status: 400 });
  }
  if (description !== undefined && (typeof description !== "string" || !description.trim())) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }
  if (date !== undefined && Number.isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: "Invalid transaction date" }, { status: 400 });
  }
  if (attachments !== undefined && (
    !Array.isArray(attachments)
    || attachments.length > 10
    || attachments.some((item) => typeof item !== "string" || !item.trim())
  )) {
    return NextResponse.json({ error: "Attachments must contain at most 10 valid references" }, { status: 400 });
  }
  if (fromUserId !== undefined && fromUserId !== null && typeof fromUserId !== "string") {
    return NextResponse.json({ error: "Invalid donor/source user" }, { status: 400 });
  }
  if (serviceId !== undefined && serviceId !== null) {
    if (typeof serviceId !== "string" || !await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } })) {
      return NextResponse.json({ error: "Linked service not found" }, { status: 400 });
    }
  }
  if (typeof fromUserId === "string" && fromUserId) {
    const sourceUser = await prisma.user.findFirst({
      where: { id: fromUserId, roles: { has: "DONOR" }, status: "ACTIVE" },
      select: { id: true },
    });
    if (!sourceUser) return NextResponse.json({ error: "Donor/source user not found" }, { status: 400 });
  }

  const isBmcReconciliation = transaction.method === "BMC"
    && !transaction.fromUserId
    && typeof fromUserId === "string"
    && Boolean(fromUserId);
  const bmcReceipt = isBmcReconciliation
    ? await prisma.bmcWebhookEvent.findFirst({
        where: { transactionId: transaction.id },
        select: { id: true, supporterId: true, supporterEmail: true, encryptedPayload: true },
      })
    : null;
  if (bmcReceipt?.supporterId) {
    const existingLink = await prisma.bmcSupporterLink.findUnique({
      where: {
        accountSlug_supporterId: {
          accountSlug: bmcAccountSlug(),
          supporterId: bmcReceipt.supporterId,
        },
      },
    });
    if (existingLink && existingLink.userId !== fromUserId) {
      return NextResponse.json({
        error: "This BMC supporter is already linked to another donor. Review the existing link before reassigning it.",
      }, { status: 409 });
    }
  }

  const data: Prisma.TransactionUpdateInput = {};
  if (amount !== undefined) data.amount = new Prisma.Decimal(amount);
  if (currency !== undefined) data.currency = currency;
  if (direction !== undefined) data.direction = direction;
  if (type !== undefined) data.type = type;
  if (method !== undefined) data.method = method;
  if (description !== undefined) data.description = description.trim();
  if (date !== undefined) data.date = new Date(date);
  if (donationFrequency !== undefined) data.donationFrequency = parseDonationFrequency(donationFrequency);
  if (attachments !== undefined) {
    data.attachments = attachments.map((item: string) => item.trim());
  }
  const effectiveDirection = direction ?? transaction.direction;
  const effectiveType = type ?? transaction.type;
  let createdServiceId: string | null = null;
  if (createService) {
    const serviceName = typeof createService.name === "string" ? createService.name.trim() : "";
    const serviceCategory = typeof createService.category === "string" ? createService.category.trim() : "";
    const serviceFrequency = ["WEEKLY", "MONTHLY", "YEARLY"].includes(createService.frequency) ? createService.frequency : null;
    const renewalAt = createService.nextRenewal ? new Date(createService.nextRenewal) : null;
    if (effectiveDirection !== "OUT" || effectiveType !== "SUBSCRIPTION" || !serviceName || !serviceCategory || !serviceFrequency || !renewalAt || Number.isNaN(renewalAt.getTime())) {
      return NextResponse.json({ error: "Creating a service requires an outgoing subscription, name, category, billing frequency and next renewal" }, { status: 400 });
    }
    const service = await prisma.service.create({
      data: {
        name: serviceName,
        category: serviceCategory,
        price: amount !== undefined ? new Prisma.Decimal(amount) : transaction.amount,
        currency: currency ?? transaction.currency,
        frequency: serviceFrequency,
        expiryDate: renewalAt,
        lastRenewalDate: date ? new Date(date) : transaction.date,
        status: "ACTIVE",
        paidTxId: id,
        attachments: attachments ?? transaction.attachments,
      },
    });
    createdServiceId = service.id;
    const repeat = serviceReminderRepeat(serviceFrequency);
    if (repeat) {
      await prisma.reminder.create({
        data: {
          createdById: user.id,
          message: `Renew ${serviceName} (${service.currency} ${service.price})`,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          nextFire: renewalAt,
          channel: "BOTH",
          recipientRoles: ["ADMIN"],
          serviceId: service.id,
        },
      });
    }
  }
  if (serviceId !== undefined || effectiveDirection !== "OUT" || effectiveType !== "SUBSCRIPTION") {
    const linkId = createdServiceId || serviceId;
    data.linkedService = effectiveDirection === "OUT" && effectiveType === "SUBSCRIPTION" && linkId
      ? { connect: { id: linkId } }
      : { disconnect: true };
  }
  if (fromUserId !== undefined || effectiveDirection === "OUT") {
    const sourceId = effectiveDirection === "OUT" ? null : fromUserId;
    data.fromUser = sourceId ? { connect: { id: sourceId } } : { disconnect: true };
  }

  const before = {
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    type: transaction.type,
    method: transaction.method,
    description: transaction.description,
    date: transaction.date.toISOString(),
    fromUserId: transaction.fromUserId,
    attachments: transaction.attachments,
    serviceId: transaction.serviceId,
  };

  const updated = await prisma.transaction.update({
    where: { id },
    data,
    include: { fromUser: true, createdBy: true, reviewedBy: true, voidedBy: true, linkedService: { select: { id: true, name: true } } },
  });

  if (isBmcReconciliation && updated.fromUserId) {
    if (bmcReceipt?.supporterId) {
      let supporterName: string | null = null;
      let supporterEmail = bmcReceipt.supporterEmail;
      if (bmcReceipt.encryptedPayload) {
        try {
          const normalized = parseBmcWebhook(decryptSecret(bmcReceipt.encryptedPayload));
          supporterName = normalized.supporterName;
          supporterEmail = normalized.supporterEmail;
        } catch {
          // Historical malformed payload: retain only the legacy email below.
        }
      }
      const supporterDetailsEncrypted = encryptSecret(JSON.stringify({ supporterName, supporterEmail }));
      await prisma.bmcSupporterLink.upsert({
        where: {
          accountSlug_supporterId: {
            accountSlug: bmcAccountSlug(),
            supporterId: bmcReceipt.supporterId,
          },
        },
        update: {
          supporterEmail: null,
          supporterDetailsEncrypted,
          lastSeenAt: new Date(),
          donationFrequency: updated.donationFrequency,
        },
        create: {
          accountSlug: bmcAccountSlug(),
          supporterId: bmcReceipt.supporterId,
          supporterEmail: null,
          supporterDetailsEncrypted,
          userId: updated.fromUserId,
          donationFrequency: updated.donationFrequency,
        },
      });
    }
    if (bmcReceipt) {
      await prisma.bmcWebhookEvent.update({
        where: { id: bmcReceipt.id },
        data: { attributionStatus: "ADMIN_RECONCILED" },
      });
    }
    if (updated.fromUser) {
      const symbol = updated.currency === "INR" ? "₹" : "$";
      await notify({
        userId: updated.fromUser.id,
        type: "TX_APPROVED",
        title: "BMC donation linked to your account",
        message: `${symbol}${updated.amount} from Buy Me a Coffee was added to your donation history.`,
        entityId: updated.id,
        actionUrl: "/donor",
        telegramMessage: formatTgMessage(
          "BMC Donation Linked",
          `${symbol}${updated.amount} added to your Sentinel history`,
        ),
      });
    }
  }
  const identityUser = updated.fromUser || updated.createdBy;

  const after = {
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    type: updated.type,
    method: updated.method,
    description: updated.description,
    date: updated.date.toISOString(),
    fromUserId: updated.fromUserId,
    attachments: updated.attachments,
    serviceId: updated.serviceId,
  };

  await logAudit({
    userId: user.id,
    action: "UPDATE",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    before,
    after,
    userName: user.name,
    details: `Updated transaction: ${updated.direction} ${updated.currency} ${updated.amount}`,
    request: req,
  });

  // GitHub immutable log
  logTransaction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    method: updated.method,
    entityId: id,
    details: `Updated: ${updated.description}`,
  });

  const changes = Object.keys(after)
    .filter((key) => before[key as keyof typeof before] !== after[key as keyof typeof after])
    .map((key) => `${key}: ${before[key as keyof typeof before]} → ${after[key as keyof typeof after]}`);
  logTransactionMutation({
    action: "UPDATED",
    id,
    actorName: user.name,
    amount: updated.amount,
    currency: updated.currency,
    direction: updated.direction,
    description: updated.description,
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    changes,
  });
  scheduleFinanceAutomation({ action: "UPDATED", actorName: user.name, transactionId: id });

  // Archive new files and retry any prior Telegram archive failures. Existing
  // successful copies are skipped using their persisted Telegram file ID.
  const attachmentArchive = updated.attachments.length > 0
    ? await archiveTransactionAttachmentsToTelegram({
        id: updated.id,
        amount: updated.amount,
        currency: updated.currency,
        description: updated.description,
        attachments: updated.attachments,
      })
    : [];

  return NextResponse.json({ transaction: updated, attachmentArchive });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!reason && isAdmin) {
    return NextResponse.json({ error: "A void reason is required" }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: "Void reason must be at most 500 characters" }, { status: 400 });
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { fromUser: true, createdBy: true },
  });
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Transaction is already voided" }, { status: 400 });
  }
  const donorCanCancel = hasRole(user.roles, "DONOR")
    && (transaction.fromUserId === user.id || transaction.createdById === user.id)
    && transaction.status === "PENDING"
    && !transaction.providerVerified;
  if (!isAdmin && !donorCanCancel) return NextResponse.json({ error: "Only your pending manual submission can be cancelled" }, { status: 403 });
  const effectiveReason = reason || "Cancelled by donor";
  const identityUser = transaction.fromUser || transaction.createdBy;

  const voided = await prisma.transaction.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: user.id, voidReason: effectiveReason },
    include: { fromUser: true, createdBy: true, reviewedBy: true, voidedBy: true },
  });

  await logAudit({
    userId: user.id,
    action: "VOID",
    entityType: "Transaction",
    entityId: id,
    before: {
      amount: transaction.amount.toString(),
      direction: transaction.direction,
      type: transaction.type,
      method: transaction.method,
      description: transaction.description,
      status: transaction.status,
    },
    after: { voidedAt: voided.voidedAt, voidedById: user.id, voidReason: effectiveReason },
    userName: user.name,
    details: `"Voided Txn:"
${transaction.direction} ${transaction.currency} ${transaction.amount} — ${transaction.description}
"Reason:"
${effectiveReason}`,
    request: req,
  });

  // GitHub immutable log
  logTransaction({
    action: "VOIDED",
    userId: user.id,
    userName: user.name,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: id,
    details: `Voided: ${transaction.description} — Reason: ${effectiveReason}`,
  });

  logTransactionMutation({
    action: "VOIDED",
    id,
    actorName: user.name,
    amount: transaction.amount,
    currency: transaction.currency,
    direction: transaction.direction,
    description: transaction.description,
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    changes: [`reason: ${effectiveReason}`],
  });
  scheduleFinanceAutomation({ action: "DELETED", actorName: user.name, transactionId: id });

  return NextResponse.json({ transaction: voided });
}
