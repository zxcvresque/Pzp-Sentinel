import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransaction, logProofScreenshot, logProofScreenshots } from "@/lib/telegram-log";
import { logTransaction as ghLogTransaction } from "@/lib/github-log";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { Prisma } from "@/generated/prisma/client";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { escapeTelegramHtml, formatTelegramIdentity } from "@/lib/telegram-format";
import { transactionOrderFromParams, transactionPageFromParams, transactionWhereFromParams } from "@/lib/transaction-query";
import { parseDonationFrequency } from "@/lib/donation-frequency";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { serviceReminderRepeat } from "@/lib/service-templates";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDonor = hasRole(user.roles, "DONOR");

  // DEV role cannot access financial data
  if (!isAdmin && !isDonor) {
    return NextResponse.json({ error: "Forbidden: insufficient role for financial data" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { page, limit } = transactionPageFromParams(searchParams);
  const where = transactionWhereFromParams(searchParams, {
    donorUserId: isAdmin ? undefined : user.id,
    forceActive: !isAdmin,
  });
  const orderBy = transactionOrderFromParams(searchParams);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        fromUser: true,
        createdBy: true,
        reviewedBy: true,
        voidedBy: true,
        linkedService: { select: { id: true, name: true } },
        ...(isAdmin ? {
          bmcWebhookEvents: {
            select: {
              supporterEmail: true,
              supporterId: true,
              attributionStatus: true,
            },
          },
        } : {}),
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  const safeTransactions = transactions.map(({ providerDetailsEncrypted: _providerDetailsEncrypted, ...transaction }) => transaction);
  return NextResponse.json({ transactions: safeTransactions, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDonor = hasRole(user.roles, "DONOR");

  // DEV role cannot create transactions (no access to financial operations)
  if (!isAdmin && !isDonor) {
    return NextResponse.json({ error: "Forbidden: DEV role cannot create transactions" }, { status: 403 });
  }

  const body = await req.json();
  const { amount, currency, method, direction, type, description, date, proofFileId, fromUserId, serviceId, createService } = body;
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const donationFrequency = parseDonationFrequency(body.donationFrequency);

  if (!amount || !description) {
    return NextResponse.json({ error: "Amount and description are required" }, { status: 400 });
  }

  if (
    attachments.length > 10
    || attachments.some((item: unknown) => typeof item !== "string" || !item.trim())
  ) {
    return NextResponse.json({ error: "Attachments must contain at most 10 valid references" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  const transactionDate = date ? new Date(date) : new Date();
  if (Number.isNaN(transactionDate.getTime())) {
    return NextResponse.json({ error: "Invalid transaction date" }, { status: 400 });
  }

  // DONOR can only create direction=IN (donations)
  if (isDonor && !isAdmin && direction && direction !== "IN") {
    return NextResponse.json({ error: "Forbidden: donors can only create incoming donations" }, { status: 403 });
  }

  // Validate IDs if provided
  if (fromUserId !== undefined && fromUserId !== null && (typeof fromUserId !== "string" || fromUserId.trim() === "")) {
    return NextResponse.json({ error: "fromUserId must be a non-empty string" }, { status: 400 });
  }
  if (serviceId) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) return NextResponse.json({ error: "Linked service not found" }, { status: 400 });
  }
  let serviceDraft: { name: string; category: string; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; nextRenewal: Date } | null = null;
  if (createService) {
    const name = typeof createService.name === "string" ? createService.name.trim() : "";
    const category = typeof createService.category === "string" ? createService.category.trim() : "";
    const frequency = ["WEEKLY", "MONTHLY", "YEARLY"].includes(createService.frequency)
      ? createService.frequency as "WEEKLY" | "MONTHLY" | "YEARLY"
      : null;
    const nextRenewal = createService.nextRenewal ? new Date(createService.nextRenewal) : null;
    if (direction !== "OUT" || type !== "SUBSCRIPTION" || !name || !category || !frequency || !nextRenewal || Number.isNaN(nextRenewal.getTime())) {
      return NextResponse.json({ error: "Creating a service requires an outgoing subscription, name, category, billing frequency and next renewal" }, { status: 400 });
    }
    serviceDraft = { name, category, frequency, nextRenewal };
  }

  const txStatus = isAdmin && direction === "OUT" ? "APPROVED" : "PENDING";

  const transaction = await prisma.$transaction(async (db) => {
    const service = serviceDraft ? await db.service.create({
      data: {
        name: serviceDraft.name,
        category: serviceDraft.category,
        price: new Prisma.Decimal(amount),
        currency: currency || "INR",
        frequency: serviceDraft.frequency,
        expiryDate: serviceDraft.nextRenewal,
        lastRenewalDate: transactionDate,
        status: "ACTIVE",
        attachments,
      },
    }) : null;
    const created = await db.transaction.create({ data: {
      amount: new Prisma.Decimal(amount),
      currency: currency || "INR",
      method: method || "OTHER",
      direction: direction || "IN",
      type: type || (direction === "IN" ? "DONATION" : "EXPENSE"),
      donationFrequency,
      description,
      date: transactionDate,
      proofFileId: proofFileId || null,
      attachments,
      fromUserId: fromUserId || (direction === "IN" ? user.id : null),
      status: txStatus,
      createdById: user.id,
      serviceId: direction === "OUT" && type === "SUBSCRIPTION" ? service?.id || serviceId || null : null,
    }, include: { fromUser: true, createdBy: true, linkedService: { select: { id: true, name: true } } } });
    if (service) {
      await db.service.update({ where: { id: service.id }, data: { paidTxId: created.id } });
      const repeat = serviceReminderRepeat(service.frequency);
      if (repeat) await db.reminder.create({ data: {
        createdById: user.id,
        message: `Renew ${service.name} (${service.currency} ${service.price})`,
        frequency: "CUSTOM",
        repeatEvery: repeat.repeatEvery,
        repeatUnit: repeat.repeatUnit,
        nextFire: service.expiryDate!,
        channel: "BOTH",
        recipientRoles: ["ADMIN"],
        serviceId: service.id,
      } });
    }
    return created;
  });
  const identityUser = transaction.fromUser || transaction.createdBy;

  await logAudit({
    userId: user.id,
    action: "CREATE",
    entityType: "Transaction",
    entityId: transaction.id,
    transactionId: transaction.id,
    after: transaction,
    userName: user.name,
    details: `${transaction.direction} ${transaction.currency} ${transaction.amount}`,
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
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    createdByName: transaction.createdBy?.name,
  });

  // GitHub immutable log
  ghLogTransaction({
    action: "CREATED",
    userId: user.id,
    userName: user.name,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: transaction.id,
    details: `${transaction.type}: ${transaction.description}`,
  });

  if (proofFileId) {
    logProofScreenshot(transaction.id, proofFileId, description);
  }

  // Legacy Telegram-backed image proofs still go to Screenshots.
  if (attachments.length > 0) {
    logProofScreenshots({
      id: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      description,
      userName: user.name,
      attachments,
    }).catch(() => {});
  }

  // All locally stored files (PDFs included) are durably copied to the
  // dedicated Attachments topic. Failure does not roll back the transaction;
  // metadata retains the error so a later edit/startup backfill can retry it.
  const attachmentArchive = attachments.length > 0
    ? await archiveTransactionAttachmentsToTelegram({
        id: transaction.id,
        amount: transaction.amount,
        currency: transaction.currency,
        description: transaction.description,
        attachments: transaction.attachments,
      })
    : [];

  // Notify admins when a pending donation needs approval
  if (txStatus === "PENDING") {
    const symbol = transaction.currency === "INR" ? "₹" : "$";
    notifyAdmins({
      type: "TX_PENDING",
      title: "Approval Required",
      message: `${identityUser.name} donated ${symbol}${transaction.amount} via ${transaction.method} — approve or reject.`,
      entityId: transaction.id,
      priority: "HIGH",
      actionUrl: "/admin/transactions",
      telegramMessage: formatTgMessage(
        "🔔 Approval Required",
        `${symbol}${transaction.amount} via ${transaction.method}`,
        `${formatTelegramIdentity({ name: identityUser.name, username: identityUser.telegramUser, telegramId: identityUser.telegramId })}\n${escapeTelegramHtml(description)}`,
      ),
    }).catch((err) => console.error("[tx] notifyAdmins failed:", err));
  }

  scheduleFinanceAutomation({
    action: "CREATED",
    actorName: user.name,
    transactionId: transaction.id,
    sendBackup: true,
  });

  return NextResponse.json({ transaction, attachmentArchive }, { status: 201 });
}
