import { describe, expect, it } from "vitest";
import {
  RAZORPAY_CHECKOUT_TIMEOUT_SECONDS,
  razorpaySubscriptionExpireBy,
} from "./razorpay-checkout";

describe("Razorpay Checkout timing", () => {
  it("limits Checkout to a 15-minute authorization session", () => {
    expect(RAZORPAY_CHECKOUT_TIMEOUT_SECONDS).toBe(900);
  });

  it("expires a monthly subscription authorization attempt after 30 minutes", () => {
    expect(razorpaySubscriptionExpireBy(1_789_000_000_999)).toBe(1_789_001_800);
  });
});
