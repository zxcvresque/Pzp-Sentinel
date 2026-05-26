import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransactionReview } from "@/lib/telegram-log";
import { logApproval, logTransaction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";
import { getAppreciation } from "@/lib/appreciation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { fromUser: true },
  });

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  if (transaction.status !== "PENDING") {
    return NextResponse.json({ error: "Transaction is not pending" }, { status: 400 });
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: { status: "APPROVED", reviewedById: user.id },
    include: { fromUser: true },
  });

  await logAudit({
    userId: user.id,
    action: "APPROVE",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    before: { status: "PENDING" },
    after: { status: "APPROVED" },
    userName: user.name,
  });

  // GitHub immutable log
  logApproval({
    action: "APPROVE",
    reviewerId: user.id,
    reviewerName: user.name,
    entityType: "Transaction",
    entityId: id,
  });
  logTransaction({
    action: "APPROVED",
    userId: user.id,
    userName: user.name,
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    method: updated.method,
    entityId: id,
    details: updated.description,
  });

  logTransactionReview({
    id,
    amount: updated.amount,
    currency: updated.currency,
    description: updated.description,
    status: "APPROVED",
    reviewerName: user.name,
  });

  // Compute donor's average for appreciation message
  let appreciation = "";
  if (updated.fromUserId) {
    const donorTxns = await prisma.transaction.findMany({
      where: {
        fromUserId: updated.fromUserId,
        status: "APPROVED",
        direction: "IN",
        id: { not: id }, // exclude this one
      },
      select: { amount: true },
    });
    const avg = donorTxns.length > 0
      ? donorTxns.reduce((s, t) => s + Number(t.amount), 0) / donorTxns.length
      : null;
    appreciation = getAppreciation(Number(updated.amount), avg);
  }

  // In-app notification + Telegram DM for the donor
  if (updated.fromUserId) {
    notify({
      userId: updated.fromUserId,
      type: "TX_APPROVED",
      title: "Donation Approved",
      message: `Your donation of ${updated.currency} ${updated.amount} has been approved. ${appreciation}`,
      entityId: id,
      priority: "NORMAL",
      actionUrl: "/donor",
      telegramMessage: formatTgMessage(
        "✅ Transaction Approved",
        `${updated.currency} ${updated.amount} approved`,
        appreciation,
      ),
    }).catch((err) => console.error("[approve] notify failed:", err));
  }

  return NextResponse.json({ transaction: updated });
}
