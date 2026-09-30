import { describe, expect, it, vi } from "vitest";
import { capturedPaymentPages } from "./razorpay-reconciliation";

describe("Razorpay payment recovery pages", () => {
  it("finds netbanking captures beyond the first 100 attempts, excluding failed UPI", async () => {
    const captured = { id: "netbanking-payment", method: "netbanking", status: "captured", captured: true };
    const fetchPage = vi.fn(async (skip: number) => ({ items: skip === 0
      ? Array.from({ length: 100 }, () => ({ id: "failed-upi", method: "upi", status: "failed", captured: false }))
      : [captured] }));
    expect(await capturedPaymentPages(fetchPage)).toEqual([captured]);
    expect(fetchPage.mock.calls.map(([skip]) => skip)).toEqual([0, 100]);
  });

  it("stops on an empty page and surfaces API failures", async () => {
    expect(await capturedPaymentPages(async () => ({}))).toEqual([]);
    await expect(capturedPaymentPages(async () => { throw new Error("API unavailable"); })).rejects.toThrow("API unavailable");
  });
});
