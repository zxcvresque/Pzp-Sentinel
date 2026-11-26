import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ history: vi.fn(), session: vi.fn(), notify: vi.fn(), link: vi.fn(), candidates: vi.fn(), update: vi.fn(), create: vi.fn(), audit: vi.fn(), ledger: vi.fn() }));
vi.mock("./db", () => ({ prisma: { transaction: { findMany: mocks.ledger }, $transaction: async (callback: (tx: object) => unknown) => callback({
  $queryRaw: vi.fn(), bmcSupporterLink: { findUnique: mocks.link }, transaction: { findMany: mocks.candidates, updateMany: mocks.update, create: mocks.create }, auditLog: { create: mocks.audit }, user: { updateMany: vi.fn() },
}) } }));
vi.mock("./notifications", () => ({ notifyAdmins: mocks.notify }));
vi.mock("./bmc-account-history", async original => ({ ...await original<object>(), fetchEntireBmcAccountHistory: mocks.history }));
vi.mock("./bmc-history", async original => ({ ...await original<object>(), bmcDashboardSession: mocks.session }));
import { BmcHistoryError } from "./bmc-history";
import { matchBmcHistoryPayment, readBmcHistorySnapshot, syncBmcAccountHistory } from "./bmc-history-sync";
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
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
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
  mocks.candidates.mockResolvedValue([{ ...transaction, bmcPaymentConfirmed: true }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ confirmed: 0 });
  expect(mocks.audit).toHaveBeenCalledOnce();
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
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  await syncBmcAccountHistory();
  expect((await readBmcHistorySnapshot())?.reviews).toMatchObject([{ id: payment.id, reason: "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED" }]);
  expect(mocks.update).not.toHaveBeenCalled();
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
it("flags a ledger-only monthly credit without reversing it or changing its XP eligibility automatically", async () => {
  mocks.history.mockResolvedValue({ subscriptions: [], payments: [], fetchedAt: new Date().toISOString(), coverage: [] });
  mocks.ledger.mockResolvedValue([{ id: "unproven-october" }]);
  expect(await syncBmcAccountHistory()).toMatchObject({ reviews: 1 });
  expect((await readBmcHistorySnapshot())?.reviews).toMatchObject([{ id: "ledger:unproven-october", transactionId: "unproven-october", reason: "LEDGER_PAYMENT_NOT_RETURNED" }]);
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
