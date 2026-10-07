import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, User } from "@/generated/prisma/client";
import { grantPzpMemberAccess, isPzpMember, registerTelegramUser } from "./member-access";
import memberIds from "./pzp-member-ids.json";

const member = memberIds.find((id) => id !== "1800754304")!;
const user = (overrides: Partial<User> = {}) => ({ id: "user", telegramId: member, roles: [], status: "ACTIVE", onboardingVersion: 0, ...overrides }) as User;
const mocks = { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() };
const db = { user: mocks, auditLog: { create: vi.fn() } } as unknown as Pick<PrismaClient, "user" | "auditLog" | "oneTimeDonationInvite">;
beforeEach(() => vi.resetAllMocks());

describe("verified PzP membership grants", () => {
  it("matches immutable member IDs and excludes bot IDs/usernames", () => {
    expect(memberIds).toHaveLength(263);
    expect(new Set(memberIds).size).toBe(memberIds.length);
    expect(isPzpMember(member)).toBe(true);
    expect(isPzpMember("@cyuuriosity")).toBe(false);
    expect(isPzpMember("8665742131")).toBe(false);
    expect(isPzpMember("99999999999")).toBe(false);
  });
  it("grants new members only donor access with first-time onboarding intact", async () => {
    mocks.upsert.mockImplementation(async ({ create }) => user(create));
    const result = await registerTelegramUser(db, { telegramId: member, telegramUser: "member", name: "Member", chatId: member });
    expect(result.roles).toEqual(["DONOR"]);
    expect(result.onboardingVersion).toBe(0);
    expect(mocks.upsert.mock.calls[0][0].create.donorAccessGrantedAt).toBeInstanceOf(Date);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("keeps outsiders pending, allowing later admin approval", async () => {
    mocks.upsert.mockImplementation(async ({ create }) => user(create));
    const outsider = await registerTelegramUser(db, { telegramId: "99999999999", telegramUser: "member", name: "Member" });
    expect(outsider.roles).toEqual([]);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    const approved = user({ telegramId: "99999999999", roles: ["DONOR"] });
    expect(await grantPzpMemberAccess(db, approved)).toBe(approved);
  });
  it("unblocks an existing roleless member without skipping onboarding", async () => {
    const donor = user({ roles: ["DONOR"] });
    mocks.findUnique.mockResolvedValue(donor);
    expect(await grantPzpMemberAccess(db, user())).toBe(donor);
    expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: "ACTIVE", NOT: { roles: { has: "DONOR" } } }, data: { roles: { push: "DONOR" } } });
    expect(mocks.updateMany.mock.calls[0][0].data).not.toHaveProperty("onboardingVersion");
  });
  it.each([user({ status: "INACTIVE" }), user({ roles: ["DONOR"] })])("preserves deactivation and existing donor access", async (existing) => {
    expect(await grantPzpMemberAccess(db, existing)).toBe(existing);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "DEV"] as const)("adds donor access alongside a member's %s role", async (role) => {
    mocks.findUnique.mockResolvedValue(user({ roles: [role, "DONOR"], donorAccessGrantedAt: new Date() }));
    expect((await grantPzpMemberAccess(db, user({ roles: [role] }))).roles).toEqual([role, "DONOR"]);
    expect(mocks.updateMany.mock.calls[0][0].data.roles).toEqual({ push: "DONOR" });
  });
  it("returns a concurrent admin deactivation instead of a stale donor grant", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(user({ status: "INACTIVE" }));
    expect((await grantPzpMemberAccess(db, user())).status).toBe("INACTIVE");
  });
  it("does not re-grant a donor role removed by an admin", async () => {
    const revoked = user({ donorAccessGrantedAt: new Date(), roles: [] });
    expect(await grantPzpMemberAccess(db, revoked)).toBe(revoked);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
