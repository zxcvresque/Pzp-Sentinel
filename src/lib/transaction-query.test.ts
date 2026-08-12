import { describe, expect, it } from "vitest";
import { transactionOrderFromParams, transactionPageFromParams, transactionWhereFromParams } from "./transaction-query";

describe("transaction query parsing", () => {
  it("defaults to active ledger entries", () => {
    expect(transactionWhereFromParams(new URLSearchParams())).toEqual({ voidedAt: null });
  });

  it("builds the complete filtered query", () => {
    const where = transactionWhereFromParams(new URLSearchParams({
      status: "APPROVED",
      direction: "IN",
      currency: "USD",
      type: "DONATION",
      method: "RAZORPAY",
      lifecycle: "VOIDED",
      amountMin: "10",
      amountMax: "50",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      search: "member",
    }));

    expect(where).toMatchObject({
      status: "APPROVED",
      direction: "IN",
      currency: "USD",
      type: "DONATION",
      method: "RAZORPAY",
      voidedAt: { not: null },
      amount: { gte: 10, lte: 50 },
    });
    expect(where.date).toBeTruthy();
    expect(where.OR).toHaveLength(4);
  });

  it("clamps pagination options and maps sorting", () => {
    expect(transactionPageFromParams(new URLSearchParams({ page: "-1", limit: "999" }))).toEqual({ page: 1, limit: 25 });
    expect(transactionOrderFromParams(new URLSearchParams({ sort: "amount_high" }))).toEqual({ amount: "desc" });
  });

  it("forces donor reads to active entries", () => {
    expect(transactionWhereFromParams(new URLSearchParams({ lifecycle: "ALL" }), { donorUserId: "donor-1", forceActive: true }))
      .toMatchObject({ fromUserId: "donor-1", voidedAt: null });
  });
});
