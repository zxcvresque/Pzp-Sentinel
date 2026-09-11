import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("./db", () => ({ prisma: { transaction: { findMany: mocks.findMany } } }));
import { getDonation, listDonations, parseDonationQuery } from "./donor-bridge-donations";

const row = {
  id: "tx1", method: "RAZORPAY", providerPaymentId: "pay_one", bmcEventId: null,
  amount: { toString: () => "1234567890123.45" }, currency: "INR", date: new Date("2026-08-12T18:30:00Z"),
  donationFrequency: "MONTHLY", voidedAt: null, voidReason: null, providerState: "CAPTURED",
  fromUser: { telegramId: "6848424735", name: "Donor" }, razorpayOrder: null,
};
beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());

describe("live donation queries", () => {
  it("allows the full history by default and respects explicit historical filters", () => {
    expect(parseDonationQuery(new URLSearchParams()).from).toBeUndefined();
    const q = parseDonationQuery(new URLSearchParams("from=2020-01-01T00:00:00Z"));
    expect(q.from?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(q.states).toEqual(["PAID", "REVERSED"]);
  });
  it("keeps old records accessible in both list and detail, and reads reversals fresh", async () => {
    const historic = { ...row, date: new Date("2020-01-01T00:00:00Z") };
    mocks.findMany.mockResolvedValue([historic]);
    const page = await listDonations(parseDonationQuery(new URLSearchParams()));
    expect(page).toMatchObject({ cutoff: null, donations: [{ occurredAt: "2020-01-01T00:00:00.000Z", state: "PAID" }] });
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("date");
    expect(await getDonation("tx1")).toMatchObject({ state: "PAID" });
    expect(mocks.findMany.mock.calls[1][0].where.AND[0]).not.toHaveProperty("date");
    mocks.findMany.mockResolvedValue([{ ...historic, providerState: "REFUNDED" }]);
    expect(await getDonation("tx1")).toMatchObject({ state: "REVERSED" });
  });
  it.each(["state=ACTIVE", "state=PAID%7C", "limit=501", "limit=-1", "limit=1.5", "offset=2147483648", "from=2026-08-13", "from=2026-02-30T00:00:00Z", "from=2026-09-01T00:00:00Z&to=2026-08-14T00:00:00Z"])("rejects invalid filters: %s", params => {
    expect(() => parseDonationQuery(new URLSearchParams(params))).toThrow();
  });
  it("reads a bounded, deterministic ledger page with eligibility and state applied before pagination", async () => {
    mocks.findMany.mockResolvedValue([row, { ...row, id: "tx2" }]);
    const page = await listDonations(parseDonationQuery(new URLSearchParams("state=PAID&limit=1&offset=4")));
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({
      where: { isTest: false, direction: "IN", type: "DONATION", status: "APPROVED", amount: { gt: 0 }, AND: [{ NOT: { OR: expect.any(Array) } }] },
      take: 2, skip: 4, orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    expect(page).toMatchObject({ hasMore: true, nextOffset: 5, donations: [{ id: "razorpay:pay_one", transactionId: "tx1", amount: "1234567890123.45", inrEstimate: "1234567890123.45", fxRate: "1", state: "PAID", lifecycle: "ACTIVE", reversalReason: null }] });
  });
  it("returns guest attribution, monthly frequency and explicit missing USD FX", async () => {
    mocks.findMany.mockResolvedValue([{ ...row, currency: "USD", fromUser: null, razorpayOrder: { paymentId: "pay_one", invite: { telegramId: "12345", guestName: "Guest" } } }]);
    expect(await getDonation("razorpay:pay_one")).toMatchObject({ telegramId: "12345", name: "Guest", frequency: "MONTHLY", inrEstimate: null, fxRate: null });
  });
  it.each(["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "REVERSED"])("exposes %s as a reversal", async providerState => {
    mocks.findMany.mockResolvedValue([{ ...row, providerState }]);
    expect(await getDonation("tx1")).toMatchObject({ state: "REVERSED", reversalReason: providerState });
  });
  it("exposes manual voids and their reason", async () => {
    mocks.findMany.mockResolvedValue([{ ...row, voidedAt: new Date(), voidReason: "Duplicate payment" }]);
    expect(await getDonation("tx1")).toMatchObject({ state: "REVERSED", lifecycle: "VOIDED", reversalReason: "Duplicate payment" });
  });
  it("resolves canonical BMC IDs using scoped and legacy aliases", async () => {
    vi.stubEnv("BMC_ACCOUNT_SLUG", "pzp");
    mocks.findMany.mockResolvedValue([{ ...row, method: "BMC", providerPaymentId: null, bmcEventId: "bmc_support_pzp_123" }]);
    expect(await getDonation("bmc:123")).toMatchObject({ id: "bmc:123", paymentId: "123" });
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0])).toContain("bmc_support_pzp_123");
  });
  it("does not return a row under its obsolete payment reference", async () => {
    mocks.findMany.mockResolvedValue([{ ...row, providerPaymentId: "pay_new" }]);
    expect(await getDonation("razorpay:pay_one")).toBeNull();
    expect(await getDonation("tx1")).toMatchObject({ id: "razorpay:pay_new" });
  });
  it("fails closed on ambiguous IDs, missing rows and invalid providers", async () => {
    mocks.findMany.mockResolvedValue([row, { ...row, id: "tx2" }]);
    await expect(getDonation("razorpay:pay_one")).rejects.toThrow("Ambiguous");
    mocks.findMany.mockResolvedValue([]);
    expect(await getDonation("tx1")).toBeNull();
    vi.clearAllMocks();
    expect(await getDonation("unknown:secret")).toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
