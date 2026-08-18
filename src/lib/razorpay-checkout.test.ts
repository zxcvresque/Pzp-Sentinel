import { describe, expect, it } from "vitest";
import {
  RAZORPAY_CHECKOUT_TIMEOUT_SECONDS,
  RAZORPAY_MONTHLY_TOTAL_COUNT,
  razorpaySubscriptionExpireBy,
} from "./razorpay-checkout";

describe("Razorpay Checkout timing", () => {
  it("limits Checkout to a 15-minute authorization session", () => {
    expect(RAZORPAY_CHECKOUT_TIMEOUT_SECONDS).toBe(900);
  });

  it("limits a monthly donation mandate to five years", () => {
    expect(RAZORPAY_MONTHLY_TOTAL_COUNT).toBe(60);
  });

  it("expires a monthly subscription authorization attempt after 30 minutes", () => {
    expect(razorpaySubscriptionExpireBy(1_789_000_000_999)).toBe(1_789_001_800);
  });
});
