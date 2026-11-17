import type { PrismaClient } from "@/generated/prisma/client";
import type { User } from "@/generated/prisma/client";
import memberIds from "./pzp-member-ids.json";
import { applyDonationAccessDeadline } from "./undonated-account-cleanup";

// Generated from scripts/members.txt by npm run members:sync; bot IDs excluded.
const members = new Set(memberIds);
type UserDb = Pick<PrismaClient, "user" | "auditLog" | "oneTimeDonationInvite">;
type TelegramIdentity = {
  telegramId: string;
  telegramUser: string;
  name: string;
  chatId?: string;
};

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

export async function registerTelegramUser(db: UserDb, identity: TelegramIdentity): Promise<User> {
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

async function checkPzpMembership(telegramId: string): Promise<boolean | null> {
  const apiKey = process.env.PZP_MEMBERSHIP_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const response = await fetch(`https://app.piratezparty.com/api/v1/users/${telegramId}`, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const member: { user_id?: number; exists?: boolean; banned?: boolean } | null = await response.json();
    if (member?.user_id !== Number(telegramId) || typeof member.exists !== "boolean" || typeof member.banned !== "boolean") {
      return null;
    }
    return member.exists && !member.banned;
  } catch {
    return null;
  }
}

/** Call after verifying Telegram WebApp initData. Null means the lookup could not be completed. */
export async function registerTelegramWebAppUser(
  db: UserDb & Pick<PrismaClient, "$transaction">,
  identity: TelegramIdentity,
): Promise<User | null> {
  const stored = await db.user.upsert({
    where: { telegramId: identity.telegramId },
    create: { ...identity, roles: [] },
    update: { telegramId: identity.telegramId },
  });
  const user = stored.status === "ACTIVE" && stored.roles.length > 0
    ? await applyDonationAccessDeadline(db, stored)
    : stored;
  if (user.status === "ACTIVE" && (user.roles.length > 0 || user.donorAccessGrantedAt)) return user;

  const eligible = await checkPzpMembership(identity.telegramId);
  if (eligible === null) return null;
  if (!eligible) return user;

  return db.$transaction(async (tx) => {
    // Match the access state read before the remote lookup so a concurrent role
    // change or deactivation wins over the in-flight sign-in.
    const [updated] = await tx.user.updateManyAndReturn({
      where: {
        id: user.id,
        status: user.status,
        roles: { equals: user.roles },
        autoRemovedAt: user.autoRemovedAt,
        donorAccessGrantedAt: user.donorAccessGrantedAt,
      },
      data: {
        status: "ACTIVE",
        autoRemovedAt: null,
        donorAccessGrantedAt: new Date(),
        ...(user.roles.includes("DONOR") ? {} : { roles: { push: "DONOR" } }),
      },
    });

    if (!updated) return (await tx.user.findUnique({ where: { id: user.id } })) ?? user;

    await tx.auditLog.create({
      data: {
        userId: "SYSTEM",
        action: user.status === "INACTIVE" ? "AUTO_REACTIVATE_DONOR" : "AUTO_GRANT_DONOR_ACCESS",
        entityType: "User",
        entityId: user.id,
        before: { status: user.status, roles: user.roles, donorAccessGrantedAt: user.donorAccessGrantedAt?.toISOString() ?? null },
        after: {
          status: updated.status,
          roles: updated.roles,
          donorAccessGrantedAt: updated.donorAccessGrantedAt?.toISOString() ?? null,
          telegramId: identity.telegramId,
          name: identity.name,
          source: "Telegram WebApp via PzP membership API",
        },
      },
    });
    return updated;
  });
}
