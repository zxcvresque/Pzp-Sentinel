import { prisma } from "@/lib/db";
import { isEligibleDonationAnnouncement } from "@/lib/donation-announcement-policy";
import { donorHandle, groupThanks } from "@/lib/donation-thanks";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { postDonationThanks } from "@/lib/telegram-log";

const CLAIM_TTL_MS = 10 * 60 * 1000;

export async function announceDonationTransaction(transactionId: string) {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { fromUser: true },
  });
  if (!transaction?.fromUser) return { status: "ineligible" as const };

  const providerCaptured = Boolean(
    transaction.bmcEventId
      || transaction.providerPaymentId
      || transaction.razorpaySubscriptionId,
  );
  if (!isEligibleDonationAnnouncement({
    status: transaction.status,
    direction: transaction.direction,
    type: transaction.type,
    isTest: transaction.isTest,
    voidedAt: transaction.voidedAt,
    fromUserId: transaction.fromUserId,
    fromUserRoles: transaction.fromUser.roles,
    createdById: transaction.createdById,
    providerCaptured,
  })) return { status: "ineligible" as const };

  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - CLAIM_TTL_MS);
  const claim = await prisma.transaction.updateMany({
    where: {
      id: transaction.id,
      donationAnnouncedAt: null,
      OR: [
        { donationAnnouncementClaimedAt: null },
        { donationAnnouncementClaimedAt: { lt: staleBefore } },
      ],
    },
    data: { donationAnnouncementClaimedAt: claimedAt },
  });
  if (claim.count !== 1) return { status: "duplicate" as const };

  const sent = await postDonationThanks(groupThanks(
    escapeTelegramHtml(donorHandle(transaction.fromUser.name, transaction.fromUser.telegramUser)),
    Number(transaction.amount),
    transaction.currency,
    transaction.donationFrequency,
  ));
  if (!sent) {
    await prisma.transaction.updateMany({
      where: { id: transaction.id, donationAnnouncementClaimedAt: claimedAt, donationAnnouncedAt: null },
      data: { donationAnnouncementClaimedAt: null },
    });
    return { status: "failed" as const };
  }

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      donationAnnouncedAt: new Date(),
      donationAnnouncementClaimedAt: null,
    },
  });
  return { status: "sent" as const };
}

export async function reconcileDonationAnnouncements(lookbackDays = 7, limit = 50) {
  const since = new Date(Date.now() - Math.max(1, lookbackDays) * 86_400_000);
  const candidates = await prisma.transaction.findMany({
    where: {
      donationAnnouncedAt: null,
      date: { gte: since },
      status: "APPROVED",
      direction: "IN",
      type: "DONATION",
      isTest: false,
      voidedAt: null,
      fromUser: { roles: { has: "DONOR" } },
    },
    orderBy: { date: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });
  const counts = { checked: candidates.length, sent: 0, skipped: 0, failed: 0 };
  for (const candidate of candidates) {
    const result = await announceDonationTransaction(candidate.id);
    if (result.status === "sent") counts.sent++;
    else if (result.status === "failed") counts.failed++;
    else counts.skipped++;
  }
  return counts;
}
