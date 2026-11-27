import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), status: vi.fn(), import: vi.fn(), disconnect: vi.fn(), health: vi.fn(), snapshot: vi.fn(), sync: vi.fn(), after: vi.fn() }));
vi.mock("./auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./bmc-session-import", () => ({ bmcConnectionStatus: mocks.status, importBmcSession: mocks.import, disconnectBmcSession: mocks.disconnect }));
vi.mock("./bmc-history-sync", () => ({ bmcHistoryHealth: mocks.health, readBmcHistorySnapshot: mocks.snapshot, syncBmcAccountHistory: mocks.sync }));
import { GET, POST } from "../app/api/bmc/connection/route";
import { BmcHistoryError } from "./bmc-history";
const req = (body: object, origin = "https://sentinel.test") => new Request("https://sentinel.test/api/bmc/connection", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("WEBAPP_URL", "https://sentinel.test");
  mocks.user.mockResolvedValue({ id: "admin1", roles: ["ADMIN"] });
  mocks.status.mockResolvedValue({ connected: true }); mocks.health.mockResolvedValue({}); mocks.snapshot.mockResolvedValue(null); mocks.import.mockResolvedValue({ connected: true });
});
it.each([null, { id: "donor", roles: ["DONOR"] }])("rejects non-admins before touching session or history", async user => {
  mocks.user.mockResolvedValue(user);
  expect((await POST(req({ action: "import" }))).status).toBe(403);
  expect((await GET(req({}))).status).toBe(403);
  expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("blocks cross-origin session imports", async () => {
  expect((await POST(req({ action: "import", appHeaders: "private" }, "https://evil.test"))).status).toBe(403);
  expect(mocks.import).not.toHaveBeenCalled();
});
it("binds the imported session to the authenticated admin and queues verification", async () => {
  const response = await POST(req({ action: "import", appHeaders: "Cookie: app=private", studioHeaders: "Cookie: studio=private" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.import).toHaveBeenCalledWith("admin1", "Cookie: app=private", "Cookie: studio=private", undefined, undefined);
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain("private");
});
it("does not queue a sync when validation fails or leak raw errors", async () => {
  mocks.import.mockRejectedValue(Error("private cookie or password"));
  const response = await POST(req({ action: "import" }));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private cookie"); expect(mocks.after).not.toHaveBeenCalled();
});
it("does not start sync without a validated imported session", async () => {
  mocks.status.mockResolvedValue({ connected: false });
  expect((await POST(req({ action: "sync" }))).status).toBe(409); expect(mocks.after).not.toHaveBeenCalled();
});
it("rejects removed browser controls, malformed JSON and oversized imports", async () => {
  for (const action of ["start", "finish", "type", "click"]) expect((await POST(req({ action }))).status).toBe(400);
  expect((await GET(new Request("https://sentinel.test/api/bmc/connection?loginId=old"))).status).toBe(410);
  expect((await POST(req({ action: "import", appHeaders: "x".repeat(100001) }))).status).toBe(413);
  expect(mocks.import).not.toHaveBeenCalled();
});
it("returns specific safe validation failures", async () => {
  mocks.import.mockRejectedValue(new BmcHistoryError("ACCOUNT_MISMATCH", "Wrong creator account", 409));
  const response = await POST(req({ action: "import" }));
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "ACCOUNT_MISMATCH" });
});
it("disconnects without a browser or clearing retained history", async () => {
  expect((await POST(req({ action: "disconnect" }))).status).toBe(200);
  expect(mocks.disconnect).toHaveBeenCalledOnce(); expect(mocks.import).not.toHaveBeenCalled();
});
