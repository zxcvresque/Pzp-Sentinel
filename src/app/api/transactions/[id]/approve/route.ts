import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransactionReview, postDonationThanks } from "@/lib/telegram-log";
import { logApproval, logTransaction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";
import { getAppreciation } from "@/lib/appreciation";
import { groupThanks, dmThanks, donorHandle } from "@/lib/donation-thanks";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { monthlyReminderUpdate } from "@/lib/donation-frequency";

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
  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Voided transactions cannot be approved" }, { status: 400 });
  }

  if (transaction.status !== "PENDING") {
    return NextResponse.json({ error: "Transaction is not pending" }, { status: 400 });
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: { status: "APPROVED", reviewedById: user.id },
    include: { fromUser: true, createdBy: true },
  });
  const identityUser = updated.fromUser || updated.createdBy;

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
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
  });

  // Compute donor's average for appreciation message
  let appreciation = "";
  if (updated.fromUserId) {
    const donorTxns = await prisma.transaction.findMany({
      where: {
        fromUserId: updated.fromUserId,
        status: "APPROVED",
        direction: "IN",
        voidedAt: null,
        id: { not: id }, // exclude this one
      },
      select: { amount: true },
    });
    const avg = donorTxns.length > 0
      ? donorTxns.reduce((s, t) => s + Number(t.amount), 0) / donorTxns.length
      : null;
    appreciation = getAppreciation(Number(updated.amount), avg);
  }

  const isDonation = updated.type === "DONATION" && updated.direction === "IN";
  const amountNum = Number(updated.amount);
  const recorderName = updated.createdBy?.name ?? "an admin";
  // Admin recorded on behalf of a different linked donor (gets a DM note).
  const onBehalfLinked = !!updated.fromUserId && updated.fromUserId !== updated.createdById;
  // Recorded by someone other than the donor (incl. external donors).
  const onBehalf = isDonation && (onBehalfLinked || !updated.fromUserId);

  if (isDonation && updated.fromUserId) {
    const reminderUpdate = monthlyReminderUpdate(updated.donationFrequency, updated.date);
    if (reminderUpdate) {
      await prisma.user.update({ where: { id: updated.fromUserId }, data: reminderUpdate });
    }
  }

  // In-app notification + Telegram DM for the donor (tiered personal thanks for donations)
  if (updated.fromUserId) {
    const donorName = updated.fromUser?.name ?? "there";
    let dmText: string;
    if (isDonation) {
      const prefix = onBehalfLinked
        ? `ℹ️ ${recorderName} recorded this donation on your behalf.\n\n`
        : "";
      dmText = prefix + dmThanks(donorName, amountNum, updated.currency);
    } else {
      dmText = formatTgMessage(
        "✅ Transaction Approved",
        `${updated.currency} ${updated.amount} approved`,
        appreciation,
      );
    }
    notify({
      userId: updated.fromUserId,
      type: "TX_APPROVED",
      title: isDonation ? "Thank you for your donation! 💛" : "Transaction Approved",
      message: `Your donation of ${updated.currency} ${updated.amount} has been approved. ${appreciation}`.trim(),
      entityId: id,
      priority: "NORMAL",
      actionUrl: "/donor",
      telegramMessage: dmText,
    }).catch((err) => console.error("[approve] notify failed:", err));
  }

  // Public thank-you in the donations group (donations only).
  if (isDonation) {
    const handle = donorHandle(updated.fromUser?.name, updated.fromUser?.telegramUser);
    let groupMsg = groupThanks(handle, amountNum, updated.currency, updated.donationFrequency);
    if (onBehalf) groupMsg += `\n<i>(recorded by ${recorderName} on their behalf)</i>`;
    postDonationThanks(groupMsg).catch((err) =>
      console.error("[approve] group thanks failed:", err),
    );
  }

  scheduleFinanceAutomation({ action: "APPROVED", actorName: user.name, transactionId: id });

  return NextResponse.json({ transaction: updated });
}
