import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/donor-bridge", () => ({ bridgeAuthorized: mocks.authorized }));
vi.mock("@/lib/bmc-history", async original => ({ ...await original<typeof import("./bmc-history")>(), fetchBmcRenewalHistory: mocks.history }));
import { BmcHistoryError } from "./bmc-history";
import { GET } from "../app/api/sentry-bridge/bmc/subscriptions/[id]/history/route";
const ctx = { params: Promise.resolve({ id: "1146135" }) };
const req = (query = "") => new Request(`https://sentinel.test/api/sentry-bridge/bmc/subscriptions/1146135/history${query}`);
beforeEach(() => { vi.resetAllMocks(); mocks.authorized.mockReturnValue(true); });
it("requires bridge authentication before touching session or provider data", async () => {
  mocks.authorized.mockReturnValue(false);
  const r = await GET(req(), ctx);
  expect(r.status).toBe(401);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.history).not.toHaveBeenCalled();
});
it("passes only the numeric page and path subscription to the history reader", async () => {
  mocks.history.mockResolvedValue({ payments: [], readOnly: true });
  const r = await GET(req("?page=2"), ctx);
  expect(r.status).toBe(200);
  expect(mocks.history).toHaveBeenCalledWith("1146135", 2);
  expect(await r.json()).toMatchObject({ readOnly: true });
});
it("rejects invalid query pages", async () => {
  expect((await GET(req("?page=1.5"), ctx)).status).toBe(400);
  expect(mocks.history).not.toHaveBeenCalled();
});
it("reports an expired session explicitly", async () => {
  mocks.history.mockRejectedValue(new BmcHistoryError("SESSION_EXPIRED", "Reconnect the BMC dashboard session.", 503));
  const r = await GET(req(), ctx);
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ code: "SESSION_EXPIRED" });
});
it("does not expose session secrets or provider bodies from unexpected errors", async () => {
  mocks.history.mockRejectedValue(Error("private-session-secret"));
  expect(await (await GET(req(), ctx)).text()).not.toContain("private-session-secret");
});
