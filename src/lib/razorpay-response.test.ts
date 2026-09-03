import { describe, expect, it } from "vitest";
import { parseRazorpayPayload, razorpayProviderError } from "./razorpay-response";

describe("parseRazorpayPayload", () => {
  it("parses a JSON provider response", () => {
    expect(parseRazorpayPayload('{"id":"order_1"}')).toEqual({ id: "order_1" });
  });

  it("does not expose an HTML provider response", () => {
    expect(parseRazorpayPayload("<!DOCTYPE html><title>Bad gateway</title>")).toBeNull();
  });
});

describe("razorpayProviderError", () => {
  it("preserves Razorpay's actionable JSON description", () => {
    expect(razorpayProviderError(400, {
      error: { code: "BAD_REQUEST_ERROR", description: "The amount is invalid" },
    })).toMatchObject({
      message: "The amount is invalid (Razorpay HTTP 400)",
      code: "BAD_REQUEST_ERROR",
    });
  });

  it("identifies rejected production credentials without returning HTML", () => {
    const failure = razorpayProviderError(401, null);
    expect(failure.message).toContain("deployed API credentials");
    expect(failure.message).toContain("Razorpay HTTP 401");
    expect(failure.message).not.toContain("DOCTYPE");
  });

  it("identifies a provider outage", () => {
    expect(razorpayProviderError(503, null).message).toBe(
      "Razorpay is temporarily unavailable. Please try again shortly (Razorpay HTTP 503)",
    );
  });
});
