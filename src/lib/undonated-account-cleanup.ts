import type { Prisma, PrismaClient, User } from "@/generated/prisma/client";
import { IMMUTABLE_ADMIN_TELEGRAM_IDS } from "./protected-admins";

export const UNDONATED_ACCOUNT_GRACE_MS = 15 * 24 * 60 * 60 * 1000;

// Preserve pending contributions until review. Test payments and rejected
// submissions do not count as donations; refunded donations still count.
const contribution: Prisma.TransactionWhereInput = {
  type: "DONATION", direction: "IN", isTest: false, status: { in: ["APPROVED", "PENDING"] },
};

export function undonatedAccountFilter(now: Date, guestDonorIds: string[] = []): Prisma.UserWhereInput {
  const cutoff = new Date(now.getTime() - UNDONATED_ACCOUNT_GRACE_MS);
  return {
    OR: [
      { donorAccessGrantedAt: { lt: cutoff } },
      { donorAccessGrantedAt: null, createdAt: { lt: cutoff } },
    ],
    autoRemovedAt: null,
    status: "ACTIVE",
    telegramId: { notIn: [...IMMUTABLE_ADMIN_TELEGRAM_IDS, ...guestDonorIds] },
    NOT: { roles: { hasSome: ["ADMIN", "DEV"] } },
    transactionsFrom: { none: contribution },
  };
}

// Enforce the deadline during authenticated access too, including deployments
// without a continuously running polling bot. Listing cleanup handles the rest.
export async function applyDonationAccessDeadline(db: Pick<PrismaClient, "user" | "auditLog" | "oneTimeDonationInvite">, user: User, now = new Date()): Promise<User> {
  if (user.autoRemovedAt && user.status === "INACTIVE") {
    const guestDonation = await db.oneTimeDonationInvite.findFirst({
      where: { telegramId: user.telegramId, order: { is: { transaction: { is: contribution } } } }, select: { id: true },
    });
    const restored = await db.user.updateMany({
      where: { id: user.id, autoRemovedAt: { not: null }, status: "INACTIVE", ...(guestDonation ? {} : { transactionsFrom: { some: contribution } }) },
      data: { autoRemovedAt: null, status: "ACTIVE" },
    });
    if (restored.count === 1) return { ...user, status: "ACTIVE", autoRemovedAt: null };
    return user;
  }
  const grantedAt = user.donorAccessGrantedAt ?? user.createdAt;
  if (user.status !== "ACTIVE" || user.roles.some((role) => role === "ADMIN" || role === "DEV")
    || IMMUTABLE_ADMIN_TELEGRAM_IDS.has(user.telegramId)
    || !grantedAt || now.getTime() - grantedAt.getTime() <= UNDONATED_ACCOUNT_GRACE_MS) return user;
  // Guest Razorpay payments are owned by an invitation, not fromUserId. The
  // invitation's verified Telegram ID still proves that this member has donated.
  const guestDonation = await db.oneTimeDonationInvite.findFirst({
    where: { telegramId: user.telegramId, order: { is: { transaction: { is: contribution } } } }, select: { id: true },
  });
  if (guestDonation) return user;
  const result = await db.user.updateMany({
    where: { ...undonatedAccountFilter(now), id: user.id, status: "ACTIVE" },
    data: { autoRemovedAt: now, status: "INACTIVE", otpCode: null, otpExpiresAt: null },
  });
  if (result.count !== 1) return user;
  await db.auditLog.create({
    data: { userId: "SYSTEM", action: "REMOVE_UNDONATED_USER", entityType: "User", entityId: user.id, before: { telegramId: user.telegramId, name: user.name } },
  });
  return { ...user, autoRemovedAt: now, status: "INACTIVE" };
}

export async function removeUndonatedAccounts(db: PrismaClient, now = new Date()) {
  return db.$transaction(async (tx) => {
    const guestDonations = await tx.oneTimeDonationInvite.findMany({
      where: { telegramId: { not: null }, order: { is: { transaction: { is: contribution } } } },
      select: { telegramId: true },
    });
    const guestDonorIds = guestDonations.flatMap((invite) => invite.telegramId ? [invite.telegramId] : []);
    // A late bank confirmation restores only automatic removals. Explicit admin
    // deactivation clears autoRemovedAt and is never reversed here.
    const restored = await tx.user.updateMany({
      where: { autoRemovedAt: { not: null }, status: "INACTIVE", OR: [{ transactionsFrom: { some: contribution } }, { telegramId: { in: guestDonorIds } }] },
      data: { autoRemovedAt: null, status: "ACTIVE" },
    });
    const filter = undonatedAccountFilter(now, guestDonorIds);
    const candidates = await tx.user.findMany({
      where: filter, select: { id: true, telegramId: true, name: true },
      take: 100, orderBy: { createdAt: "asc" },
    });
    let removed = 0;
    for (const user of candidates) {
      // Recheck donation and admin gates at the moment of removal.
      const result = await tx.user.updateMany({
        where: { ...filter, id: user.id },
        data: { autoRemovedAt: now, status: "INACTIVE", otpCode: null, otpExpiresAt: null },
      });
      if (result.count !== 1) continue;
      await tx.auditLog.create({
        data: { userId: "SYSTEM", action: "REMOVE_UNDONATED_USER", entityType: "User", entityId: user.id, before: user },
      });
      removed++;
    }
    return { checked: candidates.length, removed, restored: restored.count };
  }, { timeout: 30_000 });
}
