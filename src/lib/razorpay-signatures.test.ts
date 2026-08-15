import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCheckoutHmac, verifySubscriptionHmac, verifyWebhookHmac } from "./razorpay-signatures";

describe("Razorpay HMAC verification", () => {
  it("accepts only a checkout signature for the exact server order and payment", () => {
    const secret = "test_secret";
    const signature = createHmac("sha256", secret).update("order_123|pay_456").digest("hex");
    expect(verifyCheckoutHmac("order_123", "pay_456", secret, signature)).toBe(true);
    expect(verifyCheckoutHmac("order_tampered", "pay_456", secret, signature)).toBe(false);
    expect(verifyCheckoutHmac("order_123", "pay_tampered", secret, signature)).toBe(false);
    expect(verifyCheckoutHmac("order_123", "pay_456", secret, "not-a-signature")).toBe(false);
  });

  it("validates the raw webhook body without reparsing it", () => {
    const secret = "webhook_secret";
    const raw = '{"event":"payment.captured","payload":{"amount":50100}}';
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyWebhookHmac(raw, secret, signature)).toBe(true);
    expect(verifyWebhookHmac(`${raw} `, secret, signature)).toBe(false);
  });

  it("validates subscription checkout using payment ID then subscription ID", () => {
    const secret = "subscription_secret";
    const paymentId = "pay_123";
    const subscriptionId = "sub_456";
    const signature = createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
    expect(verifySubscriptionHmac(subscriptionId, paymentId, secret, signature)).toBe(true);
    expect(verifySubscriptionHmac(subscriptionId, "pay_wrong", secret, signature)).toBe(false);
  });
});
