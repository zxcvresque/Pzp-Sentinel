import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), db: {} as Record<string, unknown> }));
import { evaluateBmcDonorHistory, publishVerifiedBmcDonors, type GateInput, type GateLedgerRow } from "./bmc-donor-gate";
import type { BmcAccountPayment } from "./bmc-account-history";

const USER = "user_donor_a", TG = "900000001";
function charge(supportId: string, date: string, amount = "25", extra: Partial<BmcAccountPayment> = {}): BmcAccountPayment {
  return { id: `bmc-history:${supportId}`, supportId, paymentId: `pi_${supportId}`, subscriptionId: "1", stripeSubscriptionId: "sub_one", supporterId: "9",
    amount, currency: "USD", occurredAt: date, refundStatus: "NOT_REPORTED", state: "RECORDED", evidenceSource: "BMC_RENEWAL_HISTORY", frequency: "MONTHLY", ...extra };
}
function row(payment: BmcAccountPayment, extra: Partial<GateLedgerRow> = {}): GateLedgerRow {
  return { id: `tx_${payment.supportId}`, amount: new Prisma.Decimal(payment.amount), currency: payment.currency, status: "APPROVED", voidedAt: null,
    providerState: "CAPTURED", fromUserId: USER, bmcPaymentConfirmed: true, bmcReviewReason: null, donationFrequency: payment.frequency,
    bmcHistorySupportId: payment.supportId, bmcHistoryPaymentId: payment.paymentId, providerPaymentId: null, bmcPaidDate: payment.occurredAt.slice(0, 10), publishedUserId: null, ...extra };
}
// Donor A: three real $25 charges (Aug, Sep, Nov). There was no October charge.
const paid = [charge("1", "2026-08-29T16:00:00Z"), charge("2", "2026-09-29T16:00:00Z"), charge("3", "2026-11-25T16:00:00Z")];
const input = (over: Partial<GateInput> = {}): GateInput => ({ userId: USER, telegramId: TG, supporterIds: ["9"], payments: paid, subscriptions: [],
  rows: paid.map(payment => row(payment)), unreturnedPaymentIds: new Set(), ...over });
const codes = (result: ReturnType<typeof evaluateBmcDonorHistory>) => result.issues.map(issue => issue.code);

it("verifies Donor A's three real charges as exactly USD 75", () => {
  const result = evaluateBmcDonorHistory(input());
  expect(result).toMatchObject({ verified: true, issues: [], totals: { USD: "75" }, expectedTotals: { USD: "75" } });
  expect(result.paid).toHaveLength(3);
});
it("publishes Donor A's three real charges and never the phantom October credit", () => {
  const october = row(charge("phantom", "2026-10-29T16:00:00Z"), { id: "tx_october", bmcHistorySupportId: null, bmcHistoryPaymentId: null, bmcPaymentConfirmed: false });
  const result = evaluateBmcDonorHistory(input({ rows: [...paid.map(payment => row(payment)), october] }));
  expect(result).toMatchObject({ verified: true, issues: [], totals: { USD: "75" } });
  expect(result.paid.map(item => item.row.id)).not.toContain("tx_october");
  expect(result.warnings).toEqual([{ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: "tx_october", warning: true }]);
  // Once an admin voids it, the warning goes away (the void is published as a reversal).
  const voided = { ...october, voidedAt: new Date(), voidReason: "No October payment in BMC history" };
  expect(evaluateBmcDonorHistory(input({ rows: [...paid.map(payment => row(payment)), voided] })).warnings).toEqual([]);
});
it("holds the donor when a row Sentry was already told is paid is no longer a BMC charge", () => {
  const told = row(charge("gone", "2026-10-29T16:00:00Z"), { id: "tx_told", bmcHistorySupportId: null, bmcHistoryPaymentId: null, publishedUserId: USER, publishedState: "PAID" });
  const result = evaluateBmcDonorHistory(input({ rows: [...paid.map(payment => row(payment)), told] }));
  expect(result.verified).toBe(false);
  expect(result.issues).toEqual([{ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: "tx_told" }]);
});
it("verifies Donor B's four $6 payments even though the ledger once lacked confirmation", () => {
  const six = ["08", "09", "10", "11"].map((month, index) => charge(`r${index}`, `2026-${month}-16T00:16:27Z`, "6"));
  expect(evaluateBmcDonorHistory(input({ payments: six, rows: six.map(payment => row(payment)) }))).toMatchObject({ verified: true, totals: { USD: "24" } });
  // A missing confirmation flag holds verification; it never turns into a reversal.
  const unconfirmed = evaluateBmcDonorHistory(input({ payments: six, rows: six.map((payment, index) => row(payment, index ? {} : { bmcPaymentConfirmed: false })) }));
  expect(codes(unconfirmed)).toEqual(["LEDGER_REVIEW_PENDING"]);
});
it("treats Donor C's enriched payment as one donation, not two", () => {
  const five = charge("o1", "2026-10-02T00:00:00Z", "5", { frequency: "ONE_TIME", evidenceSource: "BMC_ONE_TIME_HISTORY" });
  const enriched = row(five, { providerPaymentId: five.paymentId, bmcHistoryPaymentId: five.paymentId });
  expect(evaluateBmcDonorHistory(input({ payments: [five], rows: [enriched] }))).toMatchObject({ verified: true, totals: { USD: "5" } });
  const duplicate = { ...enriched, id: "tx_second", bmcHistorySupportId: null, bmcHistoryPaymentId: null };
  expect(codes(evaluateBmcDonorHistory(input({ payments: [five], rows: [enriched, duplicate] })))).toEqual(["DUPLICATE_LEDGER_ROWS"]);
});
it("publishes Donor D's two BMC charges ($2.07) and leaves the extra ledger row unpublished", () => {
  const ace = [charge("a1", "2026-08-17T20:31:40Z", "1.04"), charge("a2", "2026-09-17T20:31:40Z", "1.03")];
  const extra = row(charge("a_dup", "2026-08-18T00:00:00Z", "1.04"), { id: "tx_extra_august", bmcHistorySupportId: null, bmcHistoryPaymentId: null });
  const result = evaluateBmcDonorHistory(input({ payments: ace, rows: [...ace.map(payment => row(payment)), extra] }));
  expect(result).toMatchObject({ verified: true, issues: [], totals: { USD: "2.07" } });
  expect(result.warnings).toEqual([{ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: "tx_extra_august", warning: true }]);
  // A UTC evening charge keeps its UTC calendar day (17 Sep), not the IST date.
  expect(evaluateBmcDonorHistory(input({ payments: ace, rows: ace.map(payment => row(payment)) }))).toMatchObject({ verified: true, totals: { USD: "2.07" } });
  expect(codes(evaluateBmcDonorHistory(input({ payments: ace, rows: ace.map((payment, index) => row(payment, index ? { bmcPaidDate: "2026-09-18" } : {})) })))).toEqual(["PAID_DATE_MISMATCH"]);
});
it.each<[string, Partial<GateLedgerRow>, string]>([
  ["amount", { amount: new Prisma.Decimal("24.99") }, "AMOUNT_MISMATCH"],
  ["currency", { currency: "INR" }, "CURRENCY_MISMATCH"],
  ["frequency", { donationFrequency: "ONE_TIME" }, "FREQUENCY_MISMATCH"],
  ["pending approval", { status: "PENDING" }, "PAYMENT_AWAITING_APPROVAL"],
  ["rejected", { status: "REJECTED" }, "PAYMENT_NOT_APPROVED"],
  ["voided while BMC says paid", { voidedAt: new Date() }, "PAID_PAYMENT_REVERSED_IN_LEDGER"],
  ["open refund review", { bmcReviewReason: "PROVIDER_REFUND_REQUIRES_REVIEW" }, "LEDGER_REVIEW_PENDING"],
  ["other donor", { fromUserId: "someone_else" }, "DONOR_CONFLICT"],
  ["not stamped", { bmcHistorySupportId: null }, "HISTORY_LINK_MISSING"],
])("holds the whole donor when one charge has a %s conflict", (_name, change, code) => {
  const result = evaluateBmcDonorHistory(input({ rows: paid.map((payment, index) => row(payment, index === 0 ? change : {})) }));
  expect(result.verified).toBe(false);
  expect(codes(result)).toContain(code);
});
it("requires every paid charge in the ledger and every subscription returned", () => {
  expect(codes(evaluateBmcDonorHistory(input({ rows: paid.slice(0, 2).map(payment => row(payment)) })))).toEqual(["PAYMENT_MISSING_FROM_LEDGER"]);
  const missing = { id: "1", stripeId: "sub_one", supporterId: "9", status: "ACTIVE" as const, cancelled: false, cancelAtPeriodEnd: false, paused: false, cancelledAt: null, renewalAt: null, missingFromLatestCheck: true };
  expect(codes(evaluateBmcDonorHistory(input({ subscriptions: [missing] })))).toEqual(["SUBSCRIPTION_NOT_RETURNED"]);
  expect(codes(evaluateBmcDonorHistory(input({ unreturnedPaymentIds: new Set([paid[0].id]) })))).toEqual(["PAYMENT_NOT_RETURNED_BY_BMC"]);
});
it("applies refunds: an active refunded row holds, a reversed one verifies and is excluded from totals", () => {
  const refunded = paid.map((payment, index) => index === 2 ? { ...payment, refundStatus: "REFUNDED", state: "REFUNDED" } : payment);
  expect(codes(evaluateBmcDonorHistory(input({ payments: refunded })))).toEqual(["REFUND_NOT_APPLIED"]);
  const reversed = paid.map((payment, index) => row(payment, index === 2 ? { providerState: "REFUNDED" } : {}));
  expect(evaluateBmcDonorHistory(input({ payments: refunded, rows: reversed }))).toMatchObject({ verified: true, totals: { USD: "50" } });
});
it("cannot verify a EUR charge the ledger cannot represent", () => {
  const eur = charge("e1", "2026-10-01T00:00:00Z", "5", { currency: "EUR", frequency: "ONE_TIME" });
  expect(codes(evaluateBmcDonorHistory(input({ payments: [...paid, eur] })))).toEqual(["UNSUPPORTED_AMOUNT_OR_CURRENCY"]);
});
it("needs a verified Telegram ID and a supporter link; ignores other donors' charges", () => {
  expect(codes(evaluateBmcDonorHistory(input({ telegramId: null })))).toEqual(["TELEGRAM_ID_REQUIRED"]);
  expect(codes(evaluateBmcDonorHistory(input({ supporterIds: [] })))).toEqual(["SUPPORTER_LINK_REQUIRED", "SUPPORTER_LINK_REQUIRED", "SUPPORTER_LINK_REQUIRED"]);
  const other = charge("x", "2026-11-20T00:00:00Z", "6", { supporterId: "10" });
  expect(evaluateBmcDonorHistory(input({ payments: [...paid, other] })).verified).toBe(true);
});
it("sums decimals exactly across several BMC identities of one Telegram user", () => {
  const small = [charge("s1", "2026-08-29T00:00:00Z", "0.10"), charge("s2", "2026-09-29T00:00:00Z", "0.20", { supporterId: "10" })];
  expect(evaluateBmcDonorHistory(input({ supporterIds: ["9", "10"], payments: small, rows: small.map(payment => row(payment)) })).totals).toEqual({ USD: "0.3" });
});
it("holds a donor whose previously published payment was reassigned to someone else", () => {
  const moved = row(charge("m", "2026-07-01T00:00:00Z"), { fromUserId: "new_owner", publishedUserId: USER, bmcHistorySupportId: "other" });
  expect(codes(evaluateBmcDonorHistory(input({ rows: [...paid.map(payment => row(payment)), moved] })))).toEqual(["PUBLISHED_OWNERSHIP_CHANGED"]);
});

// ── Atomic publication ───────────────────────────────────────────────────────
type Store = Map<string, { userId: string; state: string; amount: string; currency: string; fingerprint: string; payload: unknown }>;
function database(ledger: Array<Record<string, unknown>>, store: Store, verifications: Map<string, Record<string, unknown>>) {
  const pub = {
    upsert: vi.fn(async ({ where, create, update }) => { store.set(where.transactionId, { ...(store.has(where.transactionId) ? update : create), amount: String((store.has(where.transactionId) ? update : create).amount) }); }),
    groupBy: vi.fn(async ({ where }) => {
      const sums = new Map<string, { amount: Prisma.Decimal; count: number }>();
      for (const value of store.values()) if (value.userId === where.userId && value.state === where.state) {
        const sum = sums.get(value.currency) || { amount: new Prisma.Decimal(0), count: 0 }; sum.amount = sum.amount.plus(value.amount); sum.count++; sums.set(value.currency, sum);
      }
      return [...sums].map(([currency, sum]) => ({ currency, _sum: { amount: sum.amount }, _count: { _all: sum.count } }));
    }),
  };
  return {
    $queryRaw: vi.fn(), user: { findUnique: vi.fn(async () => ({ telegramId: TG })) },
    bmcSupporterLink: { findMany: vi.fn(async () => [{ supporterId: "9", userId: USER }]) },
    transaction: { findMany: vi.fn(async () => ledger.map(item => ({ ...item, bmcBridgePublication: store.has(item.id as string) ? { fingerprint: store.get(item.id as string)!.fingerprint, userId: store.get(item.id as string)!.userId, state: store.get(item.id as string)!.state } : null }))) },
    bmcBridgePublication: pub,
    bmcDonorVerification: { findMany: vi.fn(async () => []), upsert: vi.fn(async ({ where, create, update }) => { verifications.set(where.userId, { ...(verifications.get(where.userId) || create), ...update }); }) },
  };
}
const ledgerRow = (payment: BmcAccountPayment, extra: Record<string, unknown> = {}) => ({ ...row(payment), method: "BMC", bmcEventId: `bmc_monthly_sub_one_${payment.supportId}`, bridgeDonationId: `bmc:${payment.supportId}`,
  date: new Date(payment.occurredAt), voidReason: null, fromUser: { telegramId: TG, name: "Donor A" }, razorpayOrder: null, ...extra });
const snapshot = (payments = paid) => ({ fetchedAt: "2026-11-28T00:00:00Z", coverage: ["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"], payments, subscriptions: [], reviews: [] });

let store: Store, verifications: Map<string, Record<string, unknown>>;
beforeEach(() => { vi.resetAllMocks(); store = new Map(); verifications = new Map(); });
function run(ledger: Array<Record<string, unknown>>) {
  const db = database(ledger, store, verifications);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
    // Simulate rollback: changes become visible only if the callback succeeds.
    const before = new Map(store);
    try { return await callback(db); } catch (error) { store.clear(); for (const [key, value] of before) store.set(key, value); throw error; }
  });
  Object.assign(mocks.db, db);
  return db;
}
// The top-level reads use the same mocked client.
vi.mock("./db", () => ({ prisma: new Proxy({}, { get: (_target, key) => key === "$transaction" ? mocks.transaction : (mocks.db as Record<string | symbol, unknown>)[key] }) }));

it("publishes a donor's whole history atomically, then makes no change on an identical re-check", async () => {
  run(paid.map(payment => ledgerRow(payment)));
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 1, blocked: 0, published: 3 });
  expect([...store.values()].map(value => value.state)).toEqual(["PAID", "PAID", "PAID"]);
  expect(verifications.get(USER)).toMatchObject({ status: "VERIFIED", verifiedTotals: { USD: "75" }, verifiedCount: 3, issues: [] });
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 1, published: 0 });
});
it("keeps the previous publication byte-for-byte when a later check finds a conflict", async () => {
  run(paid.slice(0, 2).map(payment => ledgerRow(payment)));
  await publishVerifiedBmcDonors(snapshot(paid.slice(0, 2)));
  const before = JSON.stringify([...store]);
  // November arrives, but its ledger amount disagrees with BMC: nothing new may publish.
  run(paid.map((payment, index) => ledgerRow(payment, index === 2 ? { amount: new Prisma.Decimal("24") } : {})));
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 0, blocked: 1, published: 0, newlyBlocked: [USER] });
  expect(JSON.stringify([...store])).toBe(before);
  expect(verifications.get(USER)).toMatchObject({ status: "BLOCKED", verifiedTotals: { USD: "50" }, issues: [{ code: "AMOUNT_MISMATCH", transactionId: "tx_3" }] });
});
it("publishes every BMC charge but never an extra ledger row, and records it as a warning", async () => {
  run([...paid.map(payment => ledgerRow(payment)), ledgerRow(charge("oct", "2026-10-29T16:00:00Z"), { id: "tx_october", bmcHistorySupportId: null, bmcHistoryPaymentId: null })]);
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 1, blocked: 0, published: 3 });
  expect(store.has("tx_october")).toBe(false);
  expect(verifications.get(USER)).toMatchObject({ status: "VERIFIED", verifiedTotals: { USD: "75" }, issues: [{ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: "tx_october", warning: true }] });
});
it("never silently un-publishes: a published charge missing from BMC holds the donor unchanged", async () => {
  run(paid.map(payment => ledgerRow(payment)));
  await publishVerifiedBmcDonors(snapshot());
  const before = JSON.stringify([...store]);
  run(paid.map(payment => ledgerRow(payment)));
  expect(await publishVerifiedBmcDonors(snapshot(paid.slice(0, 2)))).toMatchObject({ verified: 0, blocked: 1, published: 0 });
  expect(JSON.stringify([...store])).toBe(before);
});
it("publishes a reviewed void as a reversal once the donor's history verifies", async () => {
  run([...paid.map(payment => ledgerRow(payment)), ledgerRow(charge("oct", "2026-10-29T16:00:00Z"), { id: "tx_october", bmcHistorySupportId: null, bmcHistoryPaymentId: null, voidedAt: new Date(), voidReason: "No October payment in BMC history" })]);
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 1, published: 4 });
  expect(store.get("tx_october")).toMatchObject({ state: "REVERSED", payload: { state: "REVERSED", xpEligible: false, reversalReason: "No October payment in BMC history", verification: "BMC_COMPLETE_HISTORY" } });
  expect(verifications.get(USER)).toMatchObject({ verifiedTotals: { USD: "75" } });
});
it("rolls back the whole donor if the read-back totals disagree with verified history", async () => {
  const db = run(paid.map(payment => ledgerRow(payment)));
  db.bmcBridgePublication.groupBy.mockResolvedValue([{ currency: "USD", _sum: { amount: new Prisma.Decimal("50") }, _count: { _all: 2 } }]);
  expect(await publishVerifiedBmcDonors(snapshot())).toMatchObject({ verified: 0, failed: 1 });
  expect(store.size).toBe(0);
  expect(verifications.get(USER)).toMatchObject({ status: "BLOCKED", issues: [{ code: "VERIFICATION_ERROR" }] });
});
it("refuses to run on an incomplete history snapshot", async () => {
  run([]);
  await expect(publishVerifiedBmcDonors({ ...snapshot(), coverage: ["MONTHLY_SUPPORT"] })).rejects.toThrow("Incomplete");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
