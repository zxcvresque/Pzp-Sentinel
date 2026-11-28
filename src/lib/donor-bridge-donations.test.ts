import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, client } = vi.hoisted(() => {
  const mocks = { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn(), transaction: vi.fn(), pubGroupBy: vi.fn(), pubCount: vi.fn(), verification: vi.fn() };
  const client = () => ({ transaction: { findMany: mocks.findMany, groupBy: mocks.groupBy, count: mocks.count },
    bmcBridgePublication: { groupBy: mocks.pubGroupBy, count: mocks.pubCount }, bmcDonorVerification: { findFirst: mocks.verification } });
  return { mocks, client };
});
vi.mock("./db", () => ({ prisma: { ...client(), $transaction: mocks.transaction } }));
import { BmcUnverifiedError, getDonation, listDonations, parseDonationQuery, serializeLedgerDonation } from "./donor-bridge-donations";
import { publicationPayload } from "./bmc-donor-gate";

const row = {
  id: "tx1", method: "RAZORPAY", providerPaymentId: "pay_one", bmcEventId: null,
  amount: { toString: () => "1234567890123.45" }, currency: "INR", date: new Date("2026-08-12T18:30:00Z"),
  donationFrequency: "MONTHLY", voidedAt: null, voidReason: null, providerState: "CAPTURED",
  fromUser: { telegramId: "6848424735", name: "Donor" }, razorpayOrder: null, status: "APPROVED",
};
// A BMC ledger row together with the frozen record its donor's verification published.
function published(ledger: Record<string, unknown>, verdict: Parameters<typeof publicationPayload>[1] = { kind: "PAID", paidOn: "2026-08-12" }) {
  return { ...ledger, bmcBridgePublication: { payload: publicationPayload(ledger as never, verdict) } };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]);
  mocks.groupBy.mockResolvedValue([]); mocks.pubGroupBy.mockResolvedValue([]); mocks.count.mockResolvedValue(0); mocks.pubCount.mockResolvedValue(0); mocks.verification.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async run => run(client()));
});
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
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0].where)).not.toContain('"date"');
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
      where: { OR: [
        { isTest: false, direction: "IN", type: "DONATION", status: "APPROVED", amount: { gt: 0 }, method: { not: "BMC" }, AND: [{ NOT: { OR: expect.any(Array) } }] },
        // BMC rows are selected by their published state, not by live ledger columns.
        { method: "BMC", isTest: false, bmcBridgePublication: { is: { state: "PAID" } } },
      ] },
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
    mocks.findMany.mockResolvedValue([published({ ...row, method: "BMC", providerPaymentId: null, bmcEventId: "bmc_support_pzp_123" })]);
    expect(await getDonation("bmc:123")).toMatchObject({ id: "bmc:123", paymentId: "123", verification: "BMC_COMPLETE_HISTORY" });
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0])).toContain("bmc_support_pzp_123");
  });
  it("never serves an unpublished BMC row, whatever its live ledger state claims", async () => {
    const bmc = { ...row, method: "BMC", providerPaymentId: null, bmcEventId: "bmc_monthly_sub_period_123" };
    for (const live of [{ bmcPaymentConfirmed: false }, { bmcPaymentConfirmed: true }, { voidedAt: new Date(), voidReason: "No October payment" }]) {
      mocks.findMany.mockResolvedValue([{ ...bmc, ...live, bmcBridgePublication: null }]);
      // Unverified is neither "missing" (404) nor "reversed": it is a distinct, retryable state.
      await expect(getDonation("tx1")).rejects.toBeInstanceOf(BmcUnverifiedError);
    }
    mocks.findMany.mockResolvedValue([{ ...bmc, status: "PENDING", bmcBridgePublication: null }]);
    expect(await getDonation("tx1")).toBeNull();
  });
  it("serves the frozen verified record even after the live ledger row changes", async () => {
    const bmc = { ...row, method: "BMC", providerPaymentId: null, bmcEventId: "bmc_monthly_sub_period_123", bmcPaymentConfirmed: true };
    const frozen = published(bmc);
    mocks.findMany.mockResolvedValue([{ ...frozen, voidedAt: new Date(), voidReason: "Unreviewed edit", amount: { toString: () => "1" } }]);
    expect(await getDonation("tx1")).toEqual(frozen.bmcBridgePublication.payload);
    expect(await getDonation("tx1")).toMatchObject({ state: "PAID", xpEligible: true, verificationStatus: "CONFIRMED", amount: "1234567890123.45" });
  });
  it("publishes a verified reversal with its reason", async () => {
    const bmc = { ...row, method: "BMC", voidedAt: new Date(), voidReason: "Reviewed October paid history: no payment" };
    mocks.findMany.mockResolvedValue([published(bmc, { kind: "REVERSED", reason: bmc.voidReason })]);
    expect(await getDonation("tx1")).toMatchObject({ state: "REVERSED", verificationStatus: "REVERSED", xpEligible: false, lifecycle: "VOIDED", reversalReason: "Reviewed October paid history: no payment" });
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

it("groups a Telegram donor independently of display names and provider references", async () => {
  mocks.findMany.mockResolvedValue([
    published({ ...row, id: "one", bridgeDonationId: "bmc:old", method: "BMC", donationFrequency: "ONE_TIME", bmcPaymentConfirmed: true, providerPaymentId: "pi_new", fromUser: { telegramId: "574705248", name: "Omar" } }),
    { ...row, id: "two", method: "UPI", fromUser: { telegramId: "574705248", name: "Changed name" } },
  ]);
  mocks.groupBy.mockResolvedValue([{ currency: "INR", _sum: { amount: "100.00" }, _count: { _all: 1 } }]);
  mocks.pubGroupBy.mockResolvedValue([{ currency: "INR", _sum: { amount: "5.50" }, _count: { _all: 1 } }, { currency: "USD", _sum: { amount: "5" }, _count: { _all: 1 } }]);
  mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  mocks.verification.mockResolvedValue({ status: "BLOCKED", issues: [{ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: "x" }], lastAttemptAt: new Date("2026-11-28T00:00:00Z"), lastVerifiedAt: null, historyFetchedAt: null });
  const page = await listDonations(parseDonationQuery(new URLSearchParams("telegramId=574705248&limit=2")));
  expect(page.donor).toMatchObject({ telegramId: "574705248", donorKey: "telegram:574705248", donationCount: 3, reviewCount: 1, reversedCount: 0,
    totals: [{ currency: "INR", amount: "105.5", donationCount: 2 }, { currency: "USD", amount: "5", donationCount: 1 }],
    bmcVerification: { status: "BLOCKED", upToDate: false, unpublishedCount: 1, issues: ["LEDGER_PAYMENT_NOT_IN_BMC_HISTORY"] } });
  expect(page.donations.map(d => d.donorKey)).toEqual(["telegram:574705248", "telegram:574705248"]);
  expect(page.donations.map(d => d.idempotencyKey)).toEqual(["sentinel:transaction:one", "sentinel:transaction:two"]);
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  const where = JSON.stringify(mocks.findMany.mock.calls[0][0].where);
  expect(where).toContain('"telegramId":"574705248"');
  expect(where).not.toMatch(/Omar|Changed name|providerPaymentId/);
  expect(mocks.groupBy.mock.calls[0][0].where).not.toHaveProperty("date");
  expect(mocks.pubGroupBy.mock.calls[0][0].where).toEqual({ telegramId: "574705248", state: "PAID" });
});
it.each(["abc", "0", "-123", "123.4", "", "123456789012345678901"])("rejects malformed Telegram ID %s", telegramId => {
  expect(() => parseDonationQuery(new URLSearchParams({ telegramId }))).toThrow("telegramId");
});
it("resolves old BMC references to the pinned donation instead of emitting another donation", async () => {
  vi.stubEnv("BMC_ACCOUNT_SLUG", "pzp");
  mocks.findMany.mockResolvedValue([published({ ...row, method: "BMC", donationFrequency: "ONE_TIME", bridgeDonationId: "bmc:pinned", providerPaymentId: "pi_added", bmcEventId: "bmc_support_pzp_16287848", bmcHistorySupportId: "21013203", bmcHistoryPaymentId: "pi_added" })]);
  for (const alias of ["bmc:pinned", "bmc:16287848", "bmc:21013203", "bmc:pi_added", "tx1"]) {
    expect(await getDonation(alias)).toMatchObject({ id: "bmc:pinned", transactionId: "tx1", donorKey: "telegram:6848424735", idempotencyKey: "sentinel:transaction:tx1" });
  }
});
it("does not permit XP for an unmatched donor", async () => {
  mocks.findMany.mockResolvedValue([{ ...row, fromUser: null }]);
  expect(await getDonation("tx1")).toMatchObject({ telegramId: null, donorKey: null, xpEligible: false });
});

it("withholds a history refund awaiting review as unverified, without fabricating a reversal", async () => {
  mocks.findMany.mockResolvedValue([{ ...row, method: "BMC", bmcPaymentConfirmed: true, bmcReviewReason: "PROVIDER_REFUND_REQUIRES_REVIEW", bmcBridgePublication: null }]);
  await expect(getDonation("tx1")).rejects.toBeInstanceOf(BmcUnverifiedError);
});
it("keeps the ledger serializer available for publication without bridge-only fields", () => {
  expect(serializeLedgerDonation(row as never)).toMatchObject({ id: "razorpay:pay_one", state: "PAID" });
});
