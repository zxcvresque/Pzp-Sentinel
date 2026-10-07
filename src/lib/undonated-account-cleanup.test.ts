import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyDonationAccessDeadline, removeUndonatedAccounts, undonatedAccountFilter, UNDONATED_ACCOUNT_GRACE_MS } from "./undonated-account-cleanup";
import type { User } from "@/generated/prisma/client";

const now = new Date("2026-10-07T12:00:00Z");
const mocks = { findMany: vi.fn(), updateMany: vi.fn(), audit: vi.fn(), guestFindMany: vi.fn(), guestFindFirst: vi.fn() };
const tx = { user: { findMany: mocks.findMany, updateMany: mocks.updateMany }, auditLog: { create: mocks.audit }, oneTimeDonationInvite: { findMany: mocks.guestFindMany, findFirst: mocks.guestFindFirst } };
const db = { $transaction: async (action: (db: unknown) => unknown) => action(tx) } as unknown as PrismaClient;
beforeEach(() => { vi.resetAllMocks(); mocks.updateMany.mockResolvedValue({ count: 0 }); mocks.findMany.mockResolvedValue([]); mocks.guestFindMany.mockResolvedValue([]); mocks.guestFindFirst.mockResolvedValue(null); });

it("uses donation access age rather than visits, preserving real and pending donations and admins/devs", () => {
  const filter = undonatedAccountFilter(now);
  expect(filter.OR).toEqual([
    { donorAccessGrantedAt: { lt: new Date(now.getTime() - UNDONATED_ACCOUNT_GRACE_MS) } },
    { donorAccessGrantedAt: null, createdAt: { lt: new Date(now.getTime() - UNDONATED_ACCOUNT_GRACE_MS) } },
  ]);
  expect(filter).toMatchObject({
    autoRemovedAt: null, status: "ACTIVE", NOT: { roles: { hasSome: ["ADMIN", "DEV"] } },
    telegramId: { notIn: ["1800754304"] },
    transactionsFrom: { none: { type: "DONATION", direction: "IN", isTest: false, status: { in: ["APPROVED", "PENDING"] } } },
  });
  expect(filter).not.toHaveProperty("lastActiveAt");
});
it("hides unused accounts with an audit record while retaining their payment owners and history", async () => {
  mocks.findMany.mockResolvedValue([{ id: "unused", telegramId: "12345", name: "Unused" }]);
  mocks.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  expect(await removeUndonatedAccounts(db, now)).toEqual({ checked: 1, removed: 1, restored: 0 });
  expect(mocks.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: "unused", transactionsFrom: undonatedAccountFilter(now).transactionsFrom }, data: { status: "INACTIVE", autoRemovedAt: now, otpCode: null } });
  expect(mocks.audit.mock.calls[0][0].data.action).toBe("REMOVE_UNDONATED_USER");
});
it("does not remove or audit an account that donated or received a protected role during the scan", async () => {
  mocks.findMany.mockResolvedValue([{ id: "changed", telegramId: "12345", name: "Changed" }]);
  expect((await removeUndonatedAccounts(db, now)).removed).toBe(0);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("restores late-paid accounts only when removal was automatic", async () => {
  mocks.updateMany.mockResolvedValueOnce({ count: 1 });
  expect((await removeUndonatedAccounts(db, now)).restored).toBe(1);
  expect(mocks.updateMany.mock.calls[0][0].where).toMatchObject({ autoRemovedAt: { not: null }, status: "INACTIVE", OR: [{ transactionsFrom: { some: { isTest: false, status: { in: ["APPROVED", "PENDING"] } } } }, { telegramId: { in: [] } }] });
});

const account = (overrides: Partial<User> = {}) => ({
  id: "donor", telegramId: "12345", name: "Donor", status: "ACTIVE", roles: ["DONOR"],
  autoRemovedAt: null, donorAccessGrantedAt: null,
  createdAt: new Date(now.getTime() - UNDONATED_ACCOUNT_GRACE_MS - 1), ...overrides,
}) as User;
const accessDb = tx as unknown as Pick<PrismaClient, "user" | "auditLog" | "oneTimeDonationInvite">;

it("enforces expiry on an existing authenticated session without waiting for the polling job", async () => {
  mocks.updateMany.mockResolvedValue({ count: 1 });
  expect(await applyDonationAccessDeadline(accessDb, account(), now)).toMatchObject({ status: "INACTIVE", autoRemovedAt: now });
  expect(mocks.audit).toHaveBeenCalled();
});
it("keeps an account at exactly 15 days and does not reset the deadline when it is visited", async () => {
  const boundary = account({ createdAt: new Date(now.getTime() - UNDONATED_ACCOUNT_GRACE_MS) });
  expect(await applyDonationAccessDeadline(accessDb, boundary, now)).toBe(boundary);
  expect(mocks.updateMany).not.toHaveBeenCalled();
});
it("preserves admin deactivation, donated accounts and newly granted donor access", async () => {
  const inactive = account({ status: "INACTIVE" });
  const newAccess = account({ donorAccessGrantedAt: now });
  expect(await applyDonationAccessDeadline(accessDb, inactive, now)).toBe(inactive);
  expect(await applyDonationAccessDeadline(accessDb, newAccess, now)).toBe(newAccess);
  expect(mocks.updateMany).not.toHaveBeenCalled();
  const donated = account();
  expect(await applyDonationAccessDeadline(accessDb, donated, now)).toBe(donated);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("counts an earlier guest donation even when it has no fromUserId", async () => {
  mocks.guestFindFirst.mockResolvedValue({ id: "paid-invite" });
  const guestDonor = account();
  expect(await applyDonationAccessDeadline(accessDb, guestDonor, now)).toBe(guestDonor);
  expect(mocks.updateMany).not.toHaveBeenCalled();
  mocks.guestFindMany.mockResolvedValue([{ telegramId: guestDonor.telegramId }]);
  await removeUndonatedAccounts(db, now);
  expect(mocks.findMany.mock.calls[0][0].where.telegramId.notIn).toContain(guestDonor.telegramId);
});
