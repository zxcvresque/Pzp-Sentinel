import type { PrismaClient } from "@/generated/prisma/client";
import type { User } from "@/generated/prisma/client";
import memberIds from "./pzp-member-ids.json";
import { applyDonationAccessDeadline } from "./undonated-account-cleanup";

// Generated from scripts/members.txt by npm run members:sync; bot IDs excluded.
const members = new Set(memberIds);
type UserDb = Pick<PrismaClient, "user" | "auditLog" | "oneTimeDonationInvite">;

export function isPzpMember(telegramId: string) {
  return members.has(telegramId);
}

/** Call only after Telegram identity verification (bot update, initData or OTP). */
export async function grantPzpMemberAccess(db: UserDb, user: User): Promise<User> {
  if (!isPzpMember(user.telegramId) || user.status !== "ACTIVE" || user.roles.includes("DONOR") || user.donorAccessGrantedAt) return applyDonationAccessDeadline(db, user);

  // An admin may assign roles or deactivate the account during login. Do not
  // overwrite that decision. Append donor access alongside existing roles and
  // leave onboardingVersion at its initial value.
  await db.user.updateMany({
    where: { id: user.id, status: "ACTIVE", NOT: { roles: { has: "DONOR" } }, donorAccessGrantedAt: null },
    data: { roles: { push: "DONOR" }, donorAccessGrantedAt: new Date() },
  });
  const granted = (await db.user.findUnique({ where: { id: user.id } })) ?? user;
  return applyDonationAccessDeadline(db, granted);
}

export async function registerTelegramUser(db: UserDb, identity: {
  telegramId: string;
  telegramUser: string;
  name: string;
  chatId?: string;
}): Promise<User> {
  // Upsert also handles simultaneous first visits through the bot and webapp.
  const user = await db.user.upsert({
    where: { telegramId: identity.telegramId },
    create: {
      ...identity,
      roles: isPzpMember(identity.telegramId) ? ["DONOR"] : [],
      donorAccessGrantedAt: isPzpMember(identity.telegramId) ? new Date() : null,
    },
    update: {},
  });
  return grantPzpMemberAccess(db, user);
}
