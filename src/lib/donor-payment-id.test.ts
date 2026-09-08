import { afterEach, expect, it, vi } from "vitest";
import { donorPaymentIdentity } from "./donor-payment-id";
afterEach(() => vi.unstubAllEnvs());
it("shares the canonical payment identity between legacy/new BMC exports and the feed", () => {
  vi.stubEnv("BMC_ACCOUNT_SLUG", "pzp");
  expect(donorPaymentIdentity("BMC", "bmc_support_pzp_123", "tx").id).toBe("bmc:123");
  expect(donorPaymentIdentity("BMC", "bmc_support_123", "tx").id).toBe("bmc:123");
  expect(donorPaymentIdentity("BMC", "bmc_monthly_pzp_sub_a_period_2026-08-13", "tx").id).toBe("bmc:bmc_monthly_sub_a_period_2026-08-13");
});
it("keeps distinct providers and periods distinct", () => {
  expect(donorPaymentIdentity("RAZORPAY", "pay_123", "tx").id).toBe("razorpay:pay_123");
  expect(donorPaymentIdentity("UPI", null, "tx").id).toBe("manual:tx");
  expect(donorPaymentIdentity("BMC", "bmc_membership_123", "tx").id).not.toBe("bmc:123");
});
