import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import memberIds from "./pzp-member-ids.json";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  updateManyAndReturn: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
  sign: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { upsert: mocks.upsert }, $transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ signToken: mocks.sign, highestRole: (roles: string[]) => roles.includes("ADMIN") ? "ADMIN" : roles.includes("DEV") ? "DEV" : "DONOR", SESSION_MAX_AGE_SECONDS: 86400 }));
vi.mock("@/lib/telegram-avatar-refresh", () => ({ refreshStoredTelegramAvatar: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { POST } from "../app/api/auth/telegram/route";

const member = Number(memberIds[0]);
const newMember = 99999999999;

function membership(id: number, exists: boolean, banned: boolean) {
  return Response.json({ user_id: id, exists, banned, role: "admin" });
}

function request(id: number, valid = true, authTime = Math.floor(Date.now() / 1000)) {
  const user = JSON.stringify({ id, username: "shared_name", first_name: "Member" });
  const authDate = String(authTime);
  const secret = createHmac("sha256", "WebAppData").update("test-bot-token").digest();
  const hash = createHmac("sha256", secret).update(`auth_date=${authDate}\nuser=${user}`).digest("hex");
  const initData = new URLSearchParams({ user, auth_date: authDate, hash: valid ? hash : "invalid" }).toString();
  return new NextRequest("https://sentinel.test/api/auth/telegram", { method: "POST", body: JSON.stringify({ initData }), headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BOT_TOKEN", "test-bot-token");
  vi.stubEnv("PZP_MEMBERSHIP_API_KEY", "test-partner-key");
  vi.stubGlobal("fetch", mocks.lookup);
  mocks.sign.mockResolvedValue("signed-session");
  mocks.upsert.mockImplementation(async ({ create }) => ({
    id: "user", status: "ACTIVE", onboardingVersion: 0, donorAccessGrantedAt: null, autoRemovedAt: null, ...create,
  }));
  mocks.transaction.mockImplementation(async (work) => work({
    user: { updateManyAndReturn: mocks.updateManyAndReturn, findUnique: mocks.findUnique },
    auditLog: { create: mocks.createAudit },
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("grants a first-time WebApp user donor access from the live API without a bot chat", async () => {
  mocks.lookup.mockResolvedValue(membership(newMember, true, false));
  const grantedAt = new Date("2026-11-17T08:00:00Z");
  mocks.updateManyAndReturn.mockResolvedValue([{ id: "user", status: "ACTIVE", roles: ["DONOR"], donorAccessGrantedAt: grantedAt }]);

  const response = await POST(request(newMember));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ redirect: "/donor", user: { roles: ["DONOR"] } });
  expect(response.headers.get("set-cookie")).toContain("signed-session");
  expect(mocks.sign).toHaveBeenCalledWith({ userId: "user", roles: ["DONOR"] });
  expect(mocks.lookup).toHaveBeenCalledWith(`https://app.piratezparty.com/api/v1/users/${newMember}`, expect.objectContaining({
    headers: { "X-API-Key": "test-partner-key" }, cache: "no-store",
  }));
  expect(mocks.upsert.mock.calls[0][0].create).not.toHaveProperty("chatId");
  expect(mocks.updateManyAndReturn.mock.calls[0][0]).toMatchObject({
    where: { status: "ACTIVE", roles: { equals: [] }, donorAccessGrantedAt: null },
    data: { status: "ACTIVE", roles: { push: "DONOR" }, donorAccessGrantedAt: expect.any(Date) },
  });
  expect(mocks.updateManyAndReturn.mock.calls[0][0].data).not.toHaveProperty("onboardingVersion");
  expect(mocks.createAudit).toHaveBeenCalledExactlyOnceWith({
    data: {
      userId: "SYSTEM",
      action: "AUTO_GRANT_DONOR_ACCESS",
      entityType: "User",
      entityId: "user",
      before: { status: "ACTIVE", roles: [], donorAccessGrantedAt: null },
      after: {
        status: "ACTIVE",
        roles: ["DONOR"],
        donorAccessGrantedAt: grantedAt.toISOString(),
        telegramId: String(newMember),
        name: "Member",
        source: "Telegram WebApp via PzP membership API",
      },
    },
  });
});

it.each([[false, false], [true, true]])("keeps a new account pending when exists=%s and banned=%s even if listed locally", async (exists, banned) => {
  mocks.lookup.mockResolvedValue(membership(member, exists, banned));
  const response = await POST(request(member));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ awaitingRole: true });
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("does not grant access based on tampered Telegram identity data", async () => {
  expect((await POST(request(member, false))).status).toBe(401);
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("grants a pending account after membership is confirmed on a later WebApp sign-in", async () => {
  const existing = { id: "pending", status: "ACTIVE", roles: [], donorAccessGrantedAt: null, autoRemovedAt: null };
  mocks.upsert.mockResolvedValue(existing);
  mocks.lookup.mockResolvedValue(membership(newMember, true, false));
  mocks.updateManyAndReturn.mockResolvedValue([{ ...existing, roles: ["DONOR"] }]);
  expect((await POST(request(newMember))).status).toBe(200);
  expect(mocks.sign).toHaveBeenCalledWith({ userId: "pending", roles: ["DONOR"] });
});
it("continues to accept an outsider after an admin grants donor access", async () => {
  mocks.upsert.mockResolvedValue({ id: "approved", roles: ["DONOR"], status: "ACTIVE", telegramId: String(newMember) });
  expect((await POST(request(newMember))).status).toBe(200);
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each([
  { roles: [], autoRemovedAt: null },
  { roles: ["DONOR"], autoRemovedAt: new Date(0) },
])("reactivates an eligible account with existing roles $roles", async ({ roles, autoRemovedAt }) => {
  const inactive = { id: "inactive", roles, status: "INACTIVE", autoRemovedAt, donorAccessGrantedAt: new Date(0) };
  mocks.upsert.mockResolvedValue(inactive);
  mocks.lookup.mockResolvedValue(membership(member, true, false));
  mocks.updateManyAndReturn.mockResolvedValue([{ ...inactive, roles: ["DONOR"], status: "ACTIVE" }]);

  expect((await POST(request(member))).status).toBe(200);
  expect(mocks.updateManyAndReturn).toHaveBeenCalledWith({
    where: { id: inactive.id, status: "INACTIVE", roles: { equals: roles }, autoRemovedAt: inactive.autoRemovedAt, donorAccessGrantedAt: inactive.donorAccessGrantedAt },
    data: {
      status: "ACTIVE", autoRemovedAt: null, donorAccessGrantedAt: expect.any(Date),
      ...(roles.length === 0 ? { roles: { push: "DONOR" } } : {}),
    },
  });
  expect(mocks.createAudit).toHaveBeenCalledExactlyOnceWith({
    data: expect.objectContaining({
      action: "AUTO_REACTIVATE_DONOR",
      entityId: inactive.id,
      before: expect.objectContaining({ status: "INACTIVE", roles }),
      after: expect.objectContaining({ status: "ACTIVE", roles: ["DONOR"], telegramId: String(member) }),
    }),
  });
  expect(mocks.sign).toHaveBeenCalledWith({ userId: "inactive", roles: ["DONOR"] });
});
it("keeps an inactive account disabled when the upstream account is banned", async () => {
  mocks.upsert.mockResolvedValue({ id: "inactive", roles: ["DONOR"], status: "INACTIVE" });
  mocks.lookup.mockResolvedValue(membership(member, true, true));
  const response = await POST(request(member));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "Your account has been deactivated." });
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("honors a deactivation that happens while the membership lookup is in flight", async () => {
  mocks.lookup.mockResolvedValue(membership(member, true, false));
  mocks.updateManyAndReturn.mockResolvedValue([]);
  mocks.findUnique.mockResolvedValue({ id: "user", roles: [], status: "INACTIVE" });
  expect((await POST(request(member))).status).toBe(403);
  expect(mocks.createAudit).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("does not sign a new donor session if the audit entry fails", async () => {
  mocks.lookup.mockResolvedValue(membership(newMember, true, false));
  mocks.updateManyAndReturn.mockResolvedValue([{ id: "user", status: "ACTIVE", roles: ["DONOR"] }]);
  mocks.createAudit.mockRejectedValue(new Error("Audit write failed"));

  await expect(POST(request(newMember))).rejects.toThrow("Audit write failed");
  expect(mocks.sign).not.toHaveBeenCalled();
});
it.each([
  ["unauthorized", () => new Response(null, { status: 401 })],
  ["mismatched user ID", () => membership(member + 1, true, false)],
  ["malformed membership", () => Response.json({ user_id: member, exists: true })],
])("returns a retryable failure when the lookup response is %s", async (_, response) => {
  mocks.lookup.mockResolvedValue(response());
  expect((await POST(request(member))).status).toBe(503);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("returns a retryable failure when the membership key is missing", async () => {
  vi.stubEnv("PZP_MEMBERSHIP_API_KEY", "");
  expect((await POST(request(member))).status).toBe(503);
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it.each([-86401, 120])("rejects signed Telegram launch data with invalid age %s", async (offset) => {
  expect((await POST(request(member, true, Math.floor(Date.now() / 1000) + offset))).status).toBe(401);
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.lookup).not.toHaveBeenCalled();
});
