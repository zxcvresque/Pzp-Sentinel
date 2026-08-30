import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { parseDonationFrequency } from "@/lib/donation-frequency";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { logTransaction as logGithubTransaction } from "@/lib/github-log";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { escapeTelegramHtml, formatTelegramIdentity } from "@/lib/telegram-format";
import { logProofScreenshot, logProofScreenshots, logTransaction as logTelegramTransaction } from "@/lib/telegram-log";
import { resolveTransactionAccess } from "@/lib/transaction-access";
import { transactionOrderFromParams, transactionPageFromParams, transactionWhereFromParams } from "@/lib/transaction-query";
import { isProviderVerified } from "@/lib/provider-verification";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const access = resolveTransactionAccess(user.roles, searchParams.get("scope"));
  if (!access.allowed) return NextResponse.json({ error: "Forbidden: insufficient role for this financial view" }, { status: 403 });

  const { page, limit } = transactionPageFromParams(searchParams);
  const where = transactionWhereFromParams(searchParams, {
    donorUserId: access.selfScoped ? user.id : undefined,
    forceActive: access.selfScoped,
  });
  const [transactions, total, summary] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        fromUser: true,
        createdBy: true,
        reviewedBy: true,
        voidedBy: true,
        linkedService: access.adminLedger ? {
          select: {
            id: true,
            name: true,
            category: true,
            frequency: true,
            customRepeatEvery: true,
            customRepeatUnit: true,
            planUrl: true,
            expiryDate: true,
            autoRenew: true,
            columns: true,
            entries: true,
            credentials: {
              where: { parentId: null, deletedAt: null },
              select: { id: true, platform: true, label: true, expiresAt: true },
              orderBy: { label: "asc" },
            },
          },
        } : { select: { id: true, name: true } },
        ...(access.adminLedger ? { bmcWebhookEvents: { select: { supporterEmail: true, supporterId: true, attributionStatus: true } } } : {}),
      },
      orderBy: transactionOrderFromParams(searchParams),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
    access.selfScoped ? prisma.transaction.groupBy({
      by: ["status", "currency"],
      where: { fromUserId: user.id, voidedAt: null, isTest: false },
      _sum: { amount: true },
      _count: { _all: true },
    }) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    transactions: transactions.map((transaction) => ({
      ...transaction,
      providerVerified: isProviderVerified(transaction),
      providerDetailsEncrypted: undefined,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    summary,
  });
}

/** Donor-only manual proof submission. Admin financial events use /api/financial-events. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const access = resolveTransactionAccess(user.roles, body?.scope);
  if (!access.selfScoped) {
    return NextResponse.json({ error: "Admin financial records must use the canonical financial event workflow" }, { status: 403 });
  }

  const amount = Number(body?.amount);
  const currency = body?.currency === "USD" ? "USD" : body?.currency === "INR" ? "INR" : null;
  const method = ["UPI", "BMC", "BANK", "OTHER"].includes(body?.method) ? body.method as "UPI" | "BMC" | "BANK" | "OTHER" : null;
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const date = body?.date ? new Date(body.date) : new Date();
  const proofFileId = typeof body?.proofFileId === "string" ? body.proofFileId : null;
  const attachments: string[] = Array.isArray(body?.attachments)
    ? body.attachments.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (!(amount > 0) || !currency || !method || !description || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Complete the amount, currency, payment source and description" }, { status: 400 });
  }
  if (attachments.length > 10) return NextResponse.json({ error: "Add at most 10 proof files" }, { status: 400 });

  const transaction = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal(amount),
      currency,
      method,
      direction: "IN",
      type: "DONATION",
      donationFrequency: parseDonationFrequency(body?.donationFrequency),
      description,
      date,
      proofFileId,
      attachments,
      fromUserId: user.id,
      status: "PENDING",
      providerVerified: false,
      providerState: "MANUAL",
      createdById: user.id,
    },
    include: { fromUser: true, createdBy: true },
  });

  await logAudit({ userId: user.id, action: "MANUAL_DONATION_SUBMITTED", entityType: "Transaction", entityId: transaction.id, transactionId: transaction.id, after: transaction, userName: user.name, details: `${currency} ${amount}`, request: req });
  logTelegramTransaction({ id: transaction.id, amount: transaction.amount, currency, method, direction: "IN", type: "DONATION", description, status: "PENDING", identityName: user.name, identityTelegramUser: user.telegramUser, identityTelegramId: user.telegramId, createdByName: user.name });
  logGithubTransaction({ action: "CREATED", userId: user.id, userName: user.name, amount: transaction.amount.toString(), currency, direction: "IN", method, entityId: transaction.id, details: `DONATION: ${description}` });
  if (proofFileId) logProofScreenshot(transaction.id, proofFileId, description);
  if (attachments.length) {
    logProofScreenshots({ id: transaction.id, amount: transaction.amount, currency, description, userName: user.name, attachments }).catch(() => {});
  }
  const attachmentArchive = attachments.length ? await archiveTransactionAttachmentsToTelegram(transaction) : [];
  const symbol = currency === "INR" ? "₹" : "$";
  notifyAdmins({
    type: "TX_PENDING",
    title: "Approval Required",
    message: `${user.name} submitted ${symbol}${transaction.amount} via ${method} for review.`,
    entityId: transaction.id,
    priority: "HIGH",
    actionUrl: "/admin/transactions?status=PENDING",
    telegramMessage: formatTgMessage("🔔 Approval Required", `${symbol}${transaction.amount} via ${method}`, `${formatTelegramIdentity({ name: user.name, username: user.telegramUser, telegramId: user.telegramId })}\n${escapeTelegramHtml(description)}`),
  }).catch((error) => console.error("[tx] notifyAdmins failed:", error));
  scheduleFinanceAutomation({ action: "CREATED", actorName: user.name, transactionId: transaction.id, sendBackup: true });

  return NextResponse.json({ transaction, attachmentArchive }, { status: 201 });
}
