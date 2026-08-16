import { describe, expect, it } from "vitest";
import { bmcLegacyPageItems, bmcSubscriptionPaymentKey, nextBmcLegacyPage } from "./bmc-sync";

describe("BMC legacy sync", () => {
  it("stops when an endpoint omits pagination instead of looping forever", () => {
    expect(nextBmcLegacyPage({ data: [] }, 1)).toBeNull();
    expect(nextBmcLegacyPage({ data: [], last_page: 3 }, 1)).toBe(2);
    expect(nextBmcLegacyPage({ data: [], last_page: 3 }, 3)).toBeNull();
  });

  it("rejects provider error envelopes even when HTTP status is 200", () => {
    expect(() => bmcLegacyPageItems({ error: "Unavailable" }, "extras")).toThrow("extras: Unavailable");
    expect(() => bmcLegacyPageItems({}, "extras")).toThrow("invalid response shape");
  });

  it("creates one stable key for each subscription billing period", () => {
    expect(bmcSubscriptionPaymentKey(123, "2026-08-16T00:00:00Z"))
      .toBe("bmc_monthly_sync_123_2026-08-16");
  });
});
