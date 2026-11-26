import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), health: vi.fn(), snapshot: vi.fn() }));
vi.mock("./donor-bridge", () => ({ bridgeAuthorized: mocks.authorized }));
vi.mock("./bmc-history-sync", () => ({ bmcHistoryHealth: mocks.health, readBmcHistorySnapshot: mocks.snapshot }));
import { GET } from "../app/api/sentry-bridge/bmc/history/route";
const req = (query = "") => new Request(`https://sentinel.test/api/sentry-bridge/bmc/history${query}`);
beforeEach(() => { vi.resetAllMocks(); mocks.authorized.mockReturnValue(true); mocks.health.mockResolvedValue({}); });
it("requires the bridge secret before reading account history", async () => {
  mocks.authorized.mockReturnValue(false);
  expect((await GET(req())).status).toBe(401); expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("reports no successful snapshot as unavailable, not an empty paid history", async () => {
  mocks.snapshot.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(503);
});
it("exposes cancellation independently and preserves explicit review/freshness semantics", async () => {
  mocks.snapshot.mockResolvedValue({ fetchedAt: new Date().toISOString(), coverage: ["MONTHLY_SUPPORT"], subscriptions: [{ id: "1", status: "CANCELLED" }], payments: [{ id: "bmc-history:1", occurredAt: "2026-11-16", state: "RECORDED" }], reviews: [{ id: "bmc-history:1", reason: "LEDGER_CONFLICT" }] });
  mocks.health.mockResolvedValue({ errorCode: "SESSION_EXPIRED" });
  const response = await GET(req()); const result = await response.json();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(result).toMatchObject({ stale: true, readOnly: true, subscriptions: [{ status: "CANCELLED" }], payments: [{ state: "RECORDED", reviewReasons: ["LEDGER_CONFLICT"] }] });
});
it("paginates all stored history and rejects invalid page values", async () => {
  mocks.snapshot.mockResolvedValue({ fetchedAt: new Date().toISOString(), coverage: [], subscriptions: [], reviews: [], payments: Array.from({ length: 101 }, (_, i) => ({ id: String(i).padStart(4, "0"), occurredAt: "2026-11-16" })) });
  const result = await (await GET(req("?page=2"))).json();
  expect(result.payments).toHaveLength(1); expect(result.total).toBe(101); expect(result.hasMore).toBe(false);
  expect((await GET(req("?page=-1"))).status).toBe(400);
});
