import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pg", () => ({ default: { Pool: class { on = vi.fn(); query = vi.fn(); connect = vi.fn(); } } }));
import { bridgeAuthorized } from "./donor-bridge";

afterEach(() => vi.unstubAllEnvs());
describe("donor bridge authentication", () => {
  it("fails closed without a strong shared secret", () => {
    vi.stubEnv("SENTRY_BRIDGE_SECRET", "");
    expect(bridgeAuthorized(new Request("https://sentinel.test"))).toBe(false);
  });
  it("requires the exact bearer credential", () => {
    vi.stubEnv("SENTRY_BRIDGE_SECRET", "a".repeat(40));
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: `Bearer ${"a".repeat(40)}` } }))).toBe(true);
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: `Bearer ${"b".repeat(40)}` } }))).toBe(false);
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: "a".repeat(40) } }))).toBe(false);
  });
});
