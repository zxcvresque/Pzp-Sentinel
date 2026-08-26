import { describe, expect, it } from "vitest";
import { isProviderVerified } from "./provider-verification";

describe("isProviderVerified", () => {
  it("preserves verification for legacy provider rows with encrypted evidence", () => {
    expect(isProviderVerified({ method: "RAZORPAY", providerVerified: false, providerDetailsEncrypted: "enc:v1:evidence" })).toBe(true);
    expect(isProviderVerified({ method: "BMC", providerVerified: false, providerDetailsEncrypted: "enc:v1:evidence" })).toBe(true);
  });

  it("does not promote manual or evidence-free rows", () => {
    expect(isProviderVerified({ method: "RAZORPAY", providerVerified: false, providerDetailsEncrypted: null })).toBe(false);
    expect(isProviderVerified({ method: "UPI", providerVerified: false, providerDetailsEncrypted: "enc:v1:evidence" })).toBe(false);
  });

  it("keeps an explicit provider verification", () => {
    expect(isProviderVerified({ method: "RAZORPAY", providerVerified: true, providerDetailsEncrypted: null })).toBe(true);
  });
});
