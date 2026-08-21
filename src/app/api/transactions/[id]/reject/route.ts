import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransactionReview } from "@/lib/telegram-log";
import { logApproval, logTransaction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const { reason } = await req.json();

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { fromUser: true, createdBy: true },
  });

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Voided transactions cannot be rejected" }, { status: 400 });
  }

  if (transaction.status !== "PENDING") {
    return NextResponse.json({ error: "Transaction is not pending" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (db) => {
    const claimed = await db.transaction.updateMany({
      where: { id, status: "PENDING", voidedAt: null },
      data: {
        status: "REJECTED",
        reviewedById: user.id,
        reviewNote: reason || null,
      },
    });
    if (claimed.count !== 1) return null;
    const rejected = await db.transaction.findUniqueOrThrow({
      where: { id },
      include: { fromUser: true, createdBy: true },
    });
    if ((rejected.isAutomatedRenewal || rejected.advancesServiceCycle) && rejected.serviceId) {
      await db.service.updateMany({
        where: { id: rejected.serviceId },
        data: { autoRenew: false },
      });
    }
    if (rejected.serviceId) {
      await db.service.updateMany({
        where: { id: rejected.serviceId, paidTxId: rejected.id, lastRenewalDate: null },
        data: { status: "CANCELLED", autoRenew: false },
      });
    }
    return rejected;
  });
  if (!updated) {
    return NextResponse.json({ error: "Transaction was already reviewed" }, { status: 409 });
  }
  const identityUser = updated.fromUser || updated.createdBy;

  await logAudit({
    userId: user.id,
    action: "REJECT",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    workflowId: updated.workflowId || undefined,
    before: { status: "PENDING" },
    after: { status: "REJECTED", reviewNote: reason, autoRenewDisabled: updated.isAutomatedRenewal || updated.advancesServiceCycle },
    userName: user.name,
  });

  // GitHub immutable log
  logApproval({
    action: "REJECT",
    reviewerId: user.id,
    reviewerName: user.name,
    entityType: "Transaction",
    entityId: id,
    note: reason,
  });
  logTransaction({
    action: "REJECTED",
    userId: user.id,
    userName: user.name,
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    method: updated.method,
    entityId: id,
    details: `${updated.description}${reason ? ` — Reason: ${reason}` : ""}`,
  });

  logTransactionReview({
    id,
    amount: updated.amount,
    currency: updated.currency,
    description: updated.description,
    status: "REJECTED",
    reviewerName: user.name,
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    reason,
  });

  // In-app notification + Telegram DM for the donor
  if (updated.fromUserId) {
    const notifMessage = reason
      ? `Your donation of ${updated.currency} ${updated.amount} was rejected. Reason: ${reason}`
      : `Your donation of ${updated.currency} ${updated.amount} was rejected.`;
    const tgDetails = reason
      ? `Reviewed by ${user.name} -- Reason: ${reason}`
      : `Reviewed by ${user.name}`;
    notify({
      userId: updated.fromUserId,
      type: "TX_REJECTED",
      title: "Donation Rejected",
      message: notifMessage,
      entityId: id,
      priority: "HIGH",
      actionUrl: "/donor",
      telegramMessage: formatTgMessage(
        "❌ Transaction Rejected",
        `Your donation of ${updated.currency} ${updated.amount} was rejected`,
        tgDetails,
      ),
    }).catch((err) => console.error("[reject] notify failed:", err));
  }

  scheduleFinanceAutomation({ action: "REJECTED", actorName: user.name, transactionId: id });

  return NextResponse.json({ transaction: updated });
}
