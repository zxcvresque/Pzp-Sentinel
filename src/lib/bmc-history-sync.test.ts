import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), history: vi.fn(), session: vi.fn(), notify: vi.fn(), link: vi.fn(), candidates: vi.fn(), update: vi.fn(), create: vi.fn(), audit: vi.fn(), ledger: vi.fn(), raw: vi.fn(), transaction: vi.fn() }));
vi.mock("./db", () => ({ prisma: { transaction: { findMany: mocks.ledger }, $transaction: mocks.transaction } }));
vi.mock("./notifications", () => ({ notifyAdmins: mocks.notify }));
vi.mock("./bmc-account-history", async original => ({ ...await original<object>(), fetchEntireBmcAccountHistory: mocks.history }));
vi.mock("./bmc-history", async original => ({ ...await original<object>(), bmcDashboardSession: mocks.session }));
vi.mock("./bmc-donor-gate", () => ({ publishVerifiedBmcDonors: mocks.gate }));
import { BmcHistoryError } from "./bmc-history";
import { bmcHistoryCheckSettled, matchBmcHistoryPayment, readBmcHistorySnapshot, requestBmcHistoryCheck, syncBmcAccountHistory } from "./bmc-history-sync";
import { bmcPrivatePath, writeBmcPrivate } from "./bmc-private-store";
import type { BmcAccountPayment } from "./bmc-account-history";
const payment: BmcAccountPayment = { id: "bmc-history:11", supportId: "11", subscriptionId: "1", paymentId: "pi_paid", amount: "6.00", currency: "USD", occurredAt: "2026-11-16T00:16:27Z", refundStatus: "NOT_REPORTED", state: "RECORDED", evidenceSource: "BMC_RENEWAL_HISTORY", supporterId: "9", stripeSubscriptionId: "sub_paid", frequency: "MONTHLY" };
const transaction = { id: "tx1", amount: "6.00", currency: "USD", donationFrequency: "MONTHLY", date: new Date(payment.occurredAt), bmcEventId: "bmc_monthly_sub_paid_period_123", providerPaymentId: null, fromUserId: "donor", voidedAt: null, status: "APPROVED", providerState: "CAPTURED", bmcPaymentConfirmed: false };
let dir: string;
beforeEach(async () => {
  vi.resetAllMocks(); dir = await mkdtemp(join(tmpdir(), "sentinel-bmc-test-"));
  vi.stubEnv("BMC_DASHBOARD_SESSION_FILE", join(dir, "session.enc")); vi.stubEnv("BMC_ACCOUNT_SLUG", "creator"); vi.stubEnv("CREDENTIAL_ENC_KEY", Buffer.alloc(32, 9).toString("base64"));
  mocks.session.mockResolvedValue({ generation: "g1", connectedBy: "admin", studioCookie: "private", accountSlug: "creator" });
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [payment], fetchedAt: new Date().toISOString(), coverage: ["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"] });
  mocks.link.mockResolvedValue({ userId: "donor" }); mocks.candidates.mockResolvedValue([]); mocks.update.mockResolvedValue({ count: 1 }); mocks.create.mockResolvedValue({ id: "new1" });
  mocks.ledger.mockResolvedValue([]);
  mocks.gate.mockResolvedValue({ runId: "run", verified: 1, blocked: 0, failed: 0, published: 0, newlyBlocked: [] });
  mocks.transaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({
    $queryRaw: mocks.raw, bmcSupporterLink: { findUnique: mocks.link }, transaction: { findMany: mocks.candidates, updateMany: mocks.update, create: mocks.create }, auditLog: { create: mocks.audit }, user: { updateMany: vi.fn() },
  }));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
it("is not made ambiguous by an already-voided duplicate (an August renewal)", () => {
  const duplicate = { ...transaction, id: "dup", voidedAt: new Date(), providerState: "CAPTURED" };
  expect(matchBmcHistoryPayment(payment, [transaction, duplicate], "donor")).toMatchObject({ kind: "MATCH", transaction: { id: "tx1" } });
  // Two live rows for one charge are still ambiguous: one is an extra credit.
  expect(matchBmcHistoryPayment(payment, [transaction, { ...transaction, id: "extra" }], "donor")).toMatchObject({ kind: "REVIEW", reason: "AMBIGUOUS_MATCH" });
});
it("uses a monthly row's billing period, not its misdated date (an August renewal)", () => {
  // BMC: $1.04 on 16 Aug 17:25. Ledger: the real August row (period 16 Aug 17:24:30) and a
  // September-period row (period 16 Sep 17:24:30) that a webhook wrongly dated 16 Aug 00:00.
  const august = { ...payment, supportId: "900001", paymentId: "pi_aug", amount: "1.04", occurredAt: "2026-08-16T17:25:04Z", stripeSubscriptionId: "sub_example" };
  const real = { ...transaction, id: "aug", amount: "1.04", date: new Date("2026-08-16T17:24:33Z"), bmcEventId: "bmc_monthly_current_sub_example_period_1786901070" };
  const misdated = { ...real, id: "sep_misdated", date: new Date("2026-08-16T00:00:00Z"), bmcEventId: "bmc_monthly_creator_sub_example_period_1789579470" };
  expect(matchBmcHistoryPayment(august, [real, misdated], "donor")).toMatchObject({ kind: "MATCH", transaction: { id: "aug" } });
});
it("never matches a row already claimed by a different BMC charge", () => {
  expect(matchBmcHistoryPayment(payment, [{ ...transaction, bmcHistorySupportId: "999" }], "donor").kind).toBe("MISSING");
});
it("matches an actual charge to one unique, correctly attributed ledger entry", () => {
  expect(matchBmcHistoryPayment(payment, [transaction], "donor").kind).toBe("MATCH");
  expect(matchBmcHistoryPayment(payment, [{ ...transaction, donationFrequency: "ONE_TIME", bmcEventId: null }], "donor").kind).toBe("MISSING");
});
it("never confirms a void, failed payment, amount mismatch, duplicate or wrong donor", () => {
  for (const altered of [{ ...transaction, voidedAt: new Date() }, { ...transaction, providerState: "PAYMENT_FAILED" }, { ...transaction, amount: "25" }, { ...transaction, providerPaymentId: "pi_other" }, { ...transaction, fromUserId: "other" }]) expect(matchBmcHistoryPayment(payment, [altered], "donor").kind).toBe("REVIEW");
  expect(matchBmcHistoryPayment(payment, [transaction, { ...transaction, id: "duplicate" }], "donor")).toMatchObject({ kind: "REVIEW", reason: "AMBIGUOUS_MATCH" });
  expect(matchBmcHistoryPayment(payment, [{ ...transaction, providerPaymentId: payment.paymentId, date: new Date("2026-10-16") }], "donor")).toMatchObject({ kind: "REVIEW", reason: "DATE_OR_FREQUENCY_MISMATCH" });
});
it("confirms evidence with an audit and is idempotent when replayed", async () => {
  mocks.candidates.mockResolvedValue([transaction]);
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 1, recovered: 0 });
  expect(mocks.audit).toHaveBeenCalledOnce();
  mocks.candidates.mockResolvedValue([{ ...transaction, bmcPaymentConfirmed: true, bmcHistoryPaymentId: payment.paymentId, bmcHistorySupportId: payment.supportId, bmcPaidDate: payment.occurredAt.slice(0, 10) }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 0 });
  expect(mocks.audit).toHaveBeenCalledOnce();
});
it("returns a Prisma-supported integer from the transaction-scoped PostgreSQL lock", async () => {
  mocks.candidates.mockResolvedValue([transaction]);
  mocks.raw.mockImplementation(async (query: TemplateStringsArray) => {
    if (!query.join("").startsWith("SELECT 1::int AS acquired FROM pg_advisory_xact_lock(")) throw Object.assign(Error("UnsupportedNativeDataType: void"), { code: "P2010" });
    return [{ acquired: 1 }];
  });
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 1 });
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10000, timeout: 20000 });
});
it("identifies a ledger/database failure, keeps the old snapshot and never exposes raw provider/SQL secrets", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [], payments: [payment], reviews: [] });
  mocks.raw.mockRejectedValue(Object.assign(Error("private-cookie: secret; SQL contains donor data"), { code: "P2010" }));
  const result = await syncBmcAccountHistory();
  expect(result).toMatchObject({ code: "SYNC_DATABASE_FAILED", failedStage: "RECONCILE_LEDGER", diagnosticCode: "P2010" });
  expect((await readBmcHistorySnapshot())?.fetchedAt).toBe("2026-11-20T00:00:00Z");
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  expect(JSON.stringify([result, warn.mock.calls, mocks.notify.mock.calls])).not.toMatch(/private-cookie|donor data|SQL contains/);
  warn.mockRestore();
});
it("holds unmapped records for review without creating income or awards", async () => {
  mocks.link.mockResolvedValue(null);
  expect(await syncBmcAccountHistory()).toMatchObject({ recovered: 0, reviews: 1 });
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("recovers a missing charge only for a trusted donor and is idempotent on the next check", async () => {
  expect(await syncBmcAccountHistory()).toMatchObject({ recovered: 1, confirmed: 0 });
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ providerPaymentId: payment.paymentId, fromUserId: "donor", bmcPaymentConfirmed: true, providerVerified: true, amount: "6.00", currency: "USD", providerState: "CAPTURED" }) });
  mocks.candidates.mockResolvedValue([{ ...transaction, providerPaymentId: payment.paymentId, bmcPaymentConfirmed: true }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ recovered: 0 });
  expect(mocks.create).toHaveBeenCalledOnce();
});
it("does not confirm a record changed by a concurrent void or donor reassignment", async () => {
  mocks.candidates.mockResolvedValue([transaction]); mocks.update.mockResolvedValue({ count: 0 });
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 0, reviews: 1 });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("retains the last complete encrypted history on session expiry, notifies once and makes no financial changes", async () => {
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [], payments: [payment], reviews: [] });
  mocks.history.mockRejectedValue(new BmcHistoryError("SESSION_EXPIRED", "Reconnect BMC", 503));
  await syncBmcAccountHistory(); await syncBmcAccountHistory();
  expect((await readBmcHistorySnapshot())?.payments).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledOnce(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  expect(await readFile(bmcPrivatePath("history.enc"), "utf8")).toMatch(/^enc:v1:/);
  expect(await readFile(bmcPrivatePath("history.enc"), "utf8")).not.toContain("pi_paid");
});
it("retains a disappeared charge as review evidence, without reversing the ledger", async () => {
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [], payments: [payment], reviews: [] });
  const other = { ...payment, id: "bmc-history:12", supportId: "12", paymentId: "pi_other", supporterId: "99" };
  mocks.link.mockResolvedValue(null);
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [other], fetchedAt: new Date().toISOString(), coverage: [] });
  await syncBmcAccountHistory();
  expect((await readBmcHistorySnapshot())?.reviews).toContainEqual({ id: payment.id, reason: "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("treats a suddenly empty payment kind as a signed-out session and changes nothing", async () => {
  const previous = { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [], payments: [payment], reviews: [] };
  await writeBmcPrivate(bmcPrivatePath("history.enc"), previous);
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  expect(await syncBmcAccountHistory()).toMatchObject({ code: "SESSION_EXPIRED", failedStage: "FETCH_HISTORY" });
  expect(await readBmcHistorySnapshot()).toEqual(previous);
  expect(mocks.gate).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
});
it("publishes to the bridge only after a complete fetch, and never after a failed one", async () => {
  await syncBmcAccountHistory();
  expect(mocks.gate).toHaveBeenCalledTimes(1);
  expect(mocks.gate.mock.calls[0][0]).toMatchObject({ coverage: ["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"], payments: [payment] });
  mocks.history.mockRejectedValue(new BmcHistoryError("PROVIDER_UNAVAILABLE", "down", 503));
  await syncBmcAccountHistory();
  expect(mocks.gate).toHaveBeenCalledTimes(1);
});
it("records an explicit refund for review without treating missing evidence as a refund", async () => {
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [{ ...payment, refundStatus: "REFUNDED", state: "REFUNDED" }], fetchedAt: new Date().toISOString(), coverage: [] });
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 1, recovered: 0 });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("detects cancellation independently of paid history and notifies admins once per transition", async () => {
  const subscription = { id: "1", stripeId: "sub_paid", supporterId: "9", cancelled: false, status: "ACTIVE", paused: false, cancelAtPeriodEnd: false, cancelledAt: null, renewalAt: null };
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [subscription], payments: [], reviews: [] });
  mocks.history.mockResolvedValue({ subscriptions: [{ ...subscription, cancelled: true, status: "CANCELLED" }], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  await syncBmcAccountHistory(); await syncBmcAccountHistory();
  expect(mocks.notify).toHaveBeenCalledOnce(); expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "BMC subscription status changed" }));
  expect(mocks.update).not.toHaveBeenCalled();
});
it("retains an absent subscription as unavailable rather than inventing cancellation", async () => {
  const subscription = { id: "1", stripeId: "sub_paid", supporterId: "9", cancelled: false, status: "ACTIVE", paused: false, cancelAtPeriodEnd: false, cancelledAt: null, renewalAt: null };
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-20T00:00:00Z", coverage: [], subscriptions: [subscription], payments: [], reviews: [] });
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  await syncBmcAccountHistory(); await syncBmcAccountHistory();
  expect((await readBmcHistorySnapshot())?.subscriptions).toMatchObject([{ status: "ACTIVE", missingFromLatestCheck: true, cancelled: false }]);
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("flags on the ledger row itself any payment BMC has no record of, without voiding it", async () => {
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  mocks.ledger.mockResolvedValue([{ id: "unproven-october", providerState: "CAPTURED" }]);
  mocks.candidates.mockResolvedValue([{ id: "unproven-october" }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 1 });
  expect((await readBmcHistorySnapshot())?.reviews).toMatchObject([{ id: "ledger:unproven-october", transactionId: "unproven-october", reason: "LEDGER_PAYMENT_NOT_RETURNED" }]);
  // Every active BMC row is checked, whatever created it.
  expect(mocks.ledger.mock.calls[0][0].where).not.toHaveProperty("OR");
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["unproven-october"] }, voidedAt: null, bmcReviewReason: null }, data: { bmcReviewReason: "NOT_IN_BMC_HISTORY" } });
  expect(mocks.update.mock.calls[0][0].data).toEqual({ bmcReviewReason: "NOT_IN_BMC_HISTORY" }); // never voids or changes money
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BMC_HISTORY_NOT_FOUND", transactionId: "unproven-october" }) }));
  expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Ledger payments not in BMC records", actionUrl: "/admin/transactions?bmcRecords=NOT_IN_BMC" }));
  expect(mocks.create).not.toHaveBeenCalled();
});
it("does not flag a payment recorded moments ago that BMC has not listed yet", async () => {
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  mocks.ledger.mockResolvedValue([{ id: "just-paid", providerState: "CAPTURED", createdAt: new Date() }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 0, awaitingBmc: 1 });
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  // After an hour it is missing, not late.
  mocks.ledger.mockResolvedValue([{ id: "just-paid", providerState: "CAPTURED", createdAt: new Date(Date.now() - 61 * 60_000) }]);
  mocks.candidates.mockResolvedValue([{ id: "just-paid" }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 1, awaitingBmc: 0 });
  expect(mocks.update.mock.calls[0][0].data).toEqual({ bmcReviewReason: "NOT_IN_BMC_HISTORY" });
});
it("collapses webhook bursts into one check and re-checks while a new payment is not listed yet", async () => {
  vi.useFakeTimers();
  try {
    mocks.ledger.mockResolvedValue([{ id: "just-paid", providerState: "CAPTURED", createdAt: new Date() }]);
    expect(requestBmcHistoryCheck()).toBe(true);
    expect(requestBmcHistoryCheck()).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await bmcHistoryCheckSettled();
    expect(mocks.history).toHaveBeenCalledTimes(1);
    // The new payment was not listed yet, so a follow-up is already scheduled.
    expect(requestBmcHistoryCheck()).toBe(false);
    // BMC listed it by the follow-up: matched, so no further checks.
    mocks.ledger.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await bmcHistoryCheckSettled();
    expect(mocks.history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await bmcHistoryCheckSettled();
    expect(mocks.history).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it("clears the flag once BMC history contains the payment", async () => {
  mocks.candidates.mockResolvedValue([{ ...transaction, bmcReviewReason: "NOT_IN_BMC_HISTORY" }]);
  mocks.ledger.mockResolvedValue([{ id: "tx1", providerState: "CAPTURED" }]);
  await syncBmcAccountHistory();
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ bmcReviewReason: null, bmcHistorySupportId: "11" });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: { in: ["tx1"] }, bmcReviewReason: "NOT_IN_BMC_HISTORY" }, data: { bmcReviewReason: null } });
  expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BMC_HISTORY_NOT_FOUND" }) }));
});
it("does not call rows 'not in BMC records' when BMC has a charge they could be (ambiguous)", async () => {
  mocks.candidates.mockResolvedValue([transaction, { ...transaction, id: "tx2" }]);
  mocks.ledger.mockResolvedValue([{ id: "tx1", providerState: "CAPTURED" }, { id: "tx2", providerState: "CAPTURED" }]);
  await syncBmcAccountHistory();
  expect((await readBmcHistorySnapshot())?.reviews).toMatchObject([{ reason: "AMBIGUOUS_MATCH" }]);
  expect(mocks.update.mock.calls.every(([call]) => call.data.bmcReviewReason !== "NOT_IN_BMC_HISTORY")).toBe(true);
});

it("enriches a legacy payment without rewriting its original reference or ledger timestamp", async () => {
  mocks.candidates.mockResolvedValue([transaction]);
  await syncBmcAccountHistory();
  const change = mocks.update.mock.calls[0][0].data;
  expect(change).toMatchObject({ bmcHistoryPaymentId: "pi_paid", bmcHistorySupportId: "11", bmcPaidDate: "2026-11-16" });
  expect(change).not.toHaveProperty("providerPaymentId");
  expect(change).not.toHaveProperty("date");
  expect(change).not.toHaveProperty("bridgeDonationId");
});
it("keeps an older history discovery pending and keeps that hold on subsequent checks", async () => {
  await syncBmcAccountHistory();
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "PENDING" }) });
  const pending = { ...transaction, status: "PENDING", bmcPaymentConfirmed: true, bmcHistoryPaymentId: payment.paymentId, bmcHistorySupportId: payment.supportId };
  mocks.candidates.mockResolvedValue([pending]);
  expect(await syncBmcAccountHistory()).toMatchObject({ recovered: 0, reviews: 1 });
  expect((await readBmcHistorySnapshot())?.reviews[0].reason).toBe("HISTORICAL_PAYMENT_REQUIRES_APPROVAL");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("automatically recovers new payments after a previous complete check", async () => {
  await writeBmcPrivate(bmcPrivatePath("history.enc"), { accountSlug: "creator", fetchedAt: "2026-11-15T00:00:00Z", coverage: [], subscriptions: [], payments: [], reviews: [] });
  expect(await syncBmcAccountHistory()).toMatchObject({ recovered: 1 });
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "APPROVED" }) });
});
it("does not bind two actual charges to one ledger row even for the same donor, amount and day", () => {
  const claimed = { ...transaction, bmcPaymentConfirmed: true, bmcHistoryPaymentId: "pi_other", bmcHistorySupportId: "12" };
  // Never bound to the other charge's row; the sync then holds it as a possible existing payment.
  expect(matchBmcHistoryPayment(payment, [claimed], "donor").kind).toBe("MISSING");
});
it("uses the history claim on retries even when the original webhook resource ID differs", () => {
  expect(matchBmcHistoryPayment({ ...payment, frequency: "ONE_TIME", stripeSubscriptionId: null }, [{ ...transaction, donationFrequency: "ONE_TIME", bmcEventId: "bmc_support_creator_999", bmcHistoryPaymentId: "pi_paid", bmcHistorySupportId: "11" }], "donor")).toMatchObject({ kind: "MATCH" });
});
it("can attach an unmatched payment through an existing trusted link without matching a display name", async () => {
  mocks.candidates.mockResolvedValue([{ ...transaction, fromUserId: null }]);
  await syncBmcAccountHistory();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fromUserId: "donor" }) }));
});

it.each(["PARTIALLY_REFUNDED", "DISPUTED", "REVERSED", "PAYMENT_FAILED"])("does not let history resurrect a %s entry", providerState => {
  expect(matchBmcHistoryPayment(payment, [{ ...transaction, providerState }], "donor")).toMatchObject({ kind: "REVIEW", reason: "LEDGER_CONFLICT" });
});

it("holds a known refunded charge from new awards without automatically reversing an earlier award", async () => {
  mocks.candidates.mockResolvedValue([{ ...transaction, bmcPaymentConfirmed: true }]);
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [{ ...payment, refundStatus: "REFUNDED" }], fetchedAt: new Date().toISOString(), coverage: [] });
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 1, recovered: 0 });
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { bmcReviewReason: "PROVIDER_REFUND_REQUIRES_REVIEW" } }));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BMC_HISTORY_REFUND_REVIEW" }) }));
});
it("does not clear a known refund review when a later response omits its refund flag", async () => {
  mocks.candidates.mockResolvedValue([{ ...transaction, bmcPaymentConfirmed: true, bmcReviewReason: "PROVIDER_REFUND_REQUIRES_REVIEW" }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 0, reviews: 1 });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
