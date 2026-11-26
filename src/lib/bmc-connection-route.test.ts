import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), status: vi.fn(), control: vi.fn(), validate: vi.fn(), frame: vi.fn(), health: vi.fn(), snapshot: vi.fn(), sync: vi.fn(), after: vi.fn() }));
vi.mock("./auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./bmc-browser-connection", () => ({ bmcConnectionStatus: mocks.status, controlBmcBrowser: mocks.control, validateBmcBrowserAction: mocks.validate, bmcBrowserFrame: mocks.frame }));
vi.mock("./bmc-history-sync", () => ({ bmcHistoryHealth: mocks.health, readBmcHistorySnapshot: mocks.snapshot, syncBmcAccountHistory: mocks.sync }));
import { GET, POST } from "../app/api/bmc/connection/route";
import { BmcHistoryError } from "./bmc-history";
const req = (body: object, origin = "https://sentinel.test") => new Request("https://sentinel.test/api/bmc/connection", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("WEBAPP_URL", "https://sentinel.test");
  mocks.user.mockResolvedValue({ id: "admin1", roles: ["ADMIN"] });
  mocks.status.mockResolvedValue({ connected: true }); mocks.health.mockResolvedValue({}); mocks.snapshot.mockResolvedValue(null); mocks.validate.mockReturnValue(true); mocks.control.mockResolvedValue({ connected: true });
});
it.each([null, { id: "donor", roles: ["DONOR"] }])("rejects non-admins before touching browser or history", async user => {
  mocks.user.mockResolvedValue(user);
  expect((await POST(req({ action: "start" }))).status).toBe(403);
  expect((await GET(req({}))).status).toBe(403);
  expect(mocks.control).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("blocks cross-origin browser actions", async () => {
  expect((await POST(req({ action: "type", text: "secret" }, "https://evil.test"))).status).toBe(403);
  expect(mocks.control).not.toHaveBeenCalled();
});
it("binds actions and screenshots to the authenticated admin", async () => {
  const body = { action: "finish", loginId: "id" };
  expect((await POST(req(body))).status).toBe(200);
  expect(mocks.control).toHaveBeenCalledWith("admin1", body);
  mocks.frame.mockResolvedValue({ image: "data:image/jpeg;base64,private" });
  const response = await GET(new Request("https://sentinel.test/api/bmc/connection?loginId=id"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.frame).toHaveBeenCalledWith("admin1", "id");
});
it("queues history sync only after a successful finished connection", async () => {
  await POST(req({ action: "finish", loginId: "id" }));
  expect(mocks.after).toHaveBeenCalledOnce();
  mocks.after.mockClear(); mocks.control.mockRejectedValue(Error("private cookie or password"));
  const response = await POST(req({ action: "finish", loginId: "id" }));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private cookie");
  expect(mocks.after).not.toHaveBeenCalled();
});
it("does not start automatic sync without a completed connection", async () => {
  mocks.status.mockResolvedValue({ connected: false });
  expect((await POST(req({ action: "sync" }))).status).toBe(409);
  expect(mocks.after).not.toHaveBeenCalled();
});
it("rejects malformed actions and oversized input", async () => {
  mocks.validate.mockReturnValue(false);
  expect((await POST(req({ action: "run", script: "arbitrary JS" }))).status).toBe(400);
  expect((await POST(req({ action: "type", text: "x".repeat(9000) }))).status).toBe(413);
  expect(mocks.control).not.toHaveBeenCalled();
});
it("returns a specific, safe recovery command when Ubuntu blocks Chromium's sandbox", async () => {
  mocks.control.mockRejectedValue(new BmcHistoryError("BROWSER_SANDBOX_BLOCKED", "Ubuntu is blocking the private browser’s sandbox.", 503, "node scripts/setup-bmc-browser.mjs --apply"));
  const response = await POST(req({ action: "start" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "BROWSER_SANDBOX_BLOCKED", recoveryCommand: "node scripts/setup-bmc-browser.mjs --apply" });
  expect(mocks.after).not.toHaveBeenCalled();
});
