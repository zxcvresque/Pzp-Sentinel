import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransactionReview } from "@/lib/telegram-log";
import { logApproval, logTransaction } from "@/lib/github-log";
import { bot } from "@/lib/bot";
import { createNotification } from "@/lib/notifications";

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
    data: {
      status: "REJECTED",
      reviewedById: user.id,
      reviewNote: reason || null,
    },
    include: { fromUser: true },
  });

  await logAudit({
    userId: user.id,
    action: "REJECT",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    before: { status: "PENDING" },
    after: { status: "REJECTED", reviewNote: reason },
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
    reason,
  });

  // In-app notification for the donor
  if (updated.fromUserId) {
    const notifMessage = reason
      ? `Your donation of ${updated.currency} ${updated.amount} was rejected. Reason: ${reason}`
      : `Your donation of ${updated.currency} ${updated.amount} was rejected.`;
    await createNotification({
      userId: updated.fromUserId,
      type: "TX_REJECTED",
      title: "Donation Rejected",
      message: notifMessage,
      entityId: id,
    });
  }

  // Bot DM — in-app notification above is the fallback if this fails
  if (updated.fromUser?.chatId) {
    try {
      const msg = reason
        ? `❌ Your donation of ${updated.currency} ${updated.amount} was rejected.\nReason: ${reason}`
        : `❌ Your donation of ${updated.currency} ${updated.amount} was rejected.`;
      await bot.api.sendMessage(updated.fromUser.chatId, msg);
    } catch {
      // bot DM failed — donor will see the in-app notification
    }
  }

  return NextResponse.json({ transaction: updated });
}
