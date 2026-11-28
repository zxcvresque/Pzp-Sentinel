import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("./db", () => ({ prisma: { transaction: { findMany: mocks.findMany } } }));
vi.mock("@/lib/donor-bridge", () => import("./donor-bridge"));
vi.mock("@/lib/donor-bridge-donations", () => import("./donor-bridge-donations"));
import { GET as list } from "../app/api/sentry-bridge/donations/route";

const request = (query = "", authorized = true) => new Request("https://sentinel.test/api/sentry-bridge/donations" + query, { headers: authorized ? { Authorization: `Bearer ${"a".repeat(64)}` } : {} });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SENTRY_BRIDGE_SECRET", "a".repeat(64)); mocks.findMany.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());

it("rejects unauthorized reads before touching the database", async () => {
  expect((await list(request("", false))).status).toBe(401);
  expect(mocks.findMany).not.toHaveBeenCalled();
});
it("returns a 400 for bad filters and an uncached empty page for valid reads", async () => {
  expect((await list(request("?limit=10000"))).status).toBe(400);
  expect(mocks.findMany).not.toHaveBeenCalled();
  const response = await list(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toMatchObject({ donations: [], hasMore: false, nextOffset: null });
});
it("fails closed during a database outage without exposing exception details", async () => {
  mocks.findMany.mockRejectedValue(new Error("private database connection details"));
  const response = await list(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database");
});
