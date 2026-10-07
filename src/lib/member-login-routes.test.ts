import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import memberIds from "./pzp-member-ids.json";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { upsert: mocks.upsert, findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));
vi.mock("@/lib/auth", () => ({ signToken: mocks.sign, highestRole: (roles: string[]) => roles.includes("ADMIN") ? "ADMIN" : roles.includes("DEV") ? "DEV" : "DONOR", SESSION_MAX_AGE_SECONDS: 86400 }));
vi.mock("@/lib/telegram-avatar-refresh", () => ({ refreshStoredTelegramAvatar: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { POST } from "../app/api/auth/telegram/route";

const member = Number(memberIds[0]);
function request(id: number, valid = true, authTime = Math.floor(Date.now() / 1000)) {
  const user = JSON.stringify({ id, username: "shared_name", first_name: "Member" });
  const authDate = String(authTime);
  const secret = createHmac("sha256", "WebAppData").update("test-bot-token").digest();
  const hash = createHmac("sha256", secret).update(`auth_date=${authDate}\nuser=${user}`).digest("hex");
  const initData = new URLSearchParams({ user, auth_date: authDate, hash: valid ? hash : "invalid" }).toString();
  return new NextRequest("https://sentinel.test/api/auth/telegram", { method: "POST", body: JSON.stringify({ initData }), headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BOT_TOKEN", "test-bot-token");
  mocks.sign.mockResolvedValue("signed-session");
  mocks.upsert.mockImplementation(async ({ create }) => ({ id: "user", status: "ACTIVE", onboardingVersion: 0, ...create }));
});
afterEach(() => vi.unstubAllEnvs());

it("authenticates a first-time member and redirects to the donor welcome flow", async () => {
  const response = await POST(request(member));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ redirect: "/donor", user: { roles: ["DONOR"] } });
  expect(response.headers.get("set-cookie")).toContain("signed-session");
  expect(mocks.sign).toHaveBeenCalledWith({ userId: "user", roles: ["DONOR"] });
});
it("keeps a nonmember with the same display name/username behind admin approval", async () => {
  const response = await POST(request(99999999999));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ awaitingRole: true });
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("does not grant access based on tampered Telegram identity data", async () => {
  expect((await POST(request(member, false))).status).toBe(401);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("continues to accept an outsider after an admin grants donor access", async () => {
  mocks.upsert.mockResolvedValue({ id: "approved", roles: ["DONOR"], status: "ACTIVE", telegramId: "99999999999" });
  expect((await POST(request(99999999999))).status).toBe(200);
});
it("does not reactivate an inactive member", async () => {
  mocks.upsert.mockResolvedValue({ id: "inactive", roles: ["DONOR"], status: "INACTIVE", telegramId: String(member) });
  expect((await POST(request(member))).status).toBe(403);
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(mocks.updateMany).not.toHaveBeenCalled();
});
it.each([-86401, 120])("rejects signed Telegram launch data with invalid age %s", async (offset) => {
  expect((await POST(request(member, true, Math.floor(Date.now() / 1000) + offset))).status).toBe(401);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
