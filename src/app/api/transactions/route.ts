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

  return NextResponse.json({ transactions, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
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
  const { amount, currency, method, direction, type, description, proofFileId, fromUserId } = body;
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

  // DONOR can only create direction=IN (donations)
  if (isDonor && !isAdmin && direction && direction !== "IN") {
    return NextResponse.json({ error: "Forbidden: donors can only create incoming donations" }, { status: 403 });
  }

  // Validate IDs if provided
  if (fromUserId !== undefined && fromUserId !== null && (typeof fromUserId !== "string" || fromUserId.trim() === "")) {
    return NextResponse.json({ error: "fromUserId must be a non-empty string" }, { status: 400 });
  }

  const txStatus = isAdmin && direction === "OUT" ? "APPROVED" : "PENDING";

  const transaction = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal(amount),
      currency: currency || "INR",
      method: method || "OTHER",
      direction: direction || "IN",
      type: type || (direction === "IN" ? "DONATION" : "EXPENSE"),
      donationFrequency,
      description,
      proofFileId: proofFileId || null,
      attachments,
      fromUserId: fromUserId || (direction === "IN" ? user.id : null),
      status: txStatus,
      createdById: user.id,
    },
    include: { fromUser: true, createdBy: true },
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

  // Log proof screenshots context to TG screenshots topic
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

  return NextResponse.json({ transaction }, { status: 201 });
}
