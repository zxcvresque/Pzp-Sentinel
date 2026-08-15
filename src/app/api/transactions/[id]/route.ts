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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { amount, currency, direction, type, method, description, date, fromUserId, attachments, confirmReviewedEdit } = body;

  // Validate amount if provided
  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
  }

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
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
        select: { id: true, supporterId: true, supporterEmail: true },
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
  if (attachments !== undefined) data.attachments = attachments.map((item: string) => item.trim());
  const effectiveDirection = direction ?? transaction.direction;
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
  };

  const updated = await prisma.transaction.update({
    where: { id },
    data,
    include: { fromUser: true, createdBy: true, reviewedBy: true, voidedBy: true },
  });

  if (isBmcReconciliation && updated.fromUserId) {
    if (bmcReceipt?.supporterId) {
      await prisma.bmcSupporterLink.upsert({
        where: {
          accountSlug_supporterId: {
            accountSlug: bmcAccountSlug(),
            supporterId: bmcReceipt.supporterId,
          },
        },
        update: {
          supporterEmail: bmcReceipt.supporterEmail,
          lastSeenAt: new Date(),
          donationFrequency: updated.donationFrequency,
        },
        create: {
          accountSlug: bmcAccountSlug(),
          supporterId: bmcReceipt.supporterId,
          supporterEmail: bmcReceipt.supporterEmail,
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

  return NextResponse.json({ transaction: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
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
  const identityUser = transaction.fromUser || transaction.createdBy;

  const voided = await prisma.transaction.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason },
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
    after: { voidedAt: voided.voidedAt, voidedById: user.id, voidReason: reason },
    userName: user.name,
    details: `"Voided Txn:"
${transaction.direction} ${transaction.currency} ${transaction.amount} — ${transaction.description}
"Reason:"
${reason}`,
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
    details: `Voided: ${transaction.description} — Reason: ${reason}`,
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
    changes: [`reason: ${reason}`],
  });
  scheduleFinanceAutomation({ action: "DELETED", actorName: user.name, transactionId: id });

  return NextResponse.json({ transaction: voided });
}
