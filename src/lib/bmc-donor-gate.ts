import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { bmcAccountSlug } from "./bmc-attribution";
import type { BmcAccountPayment, BmcSubscription } from "./bmc-account-history";
import { donationSelect, serializeLedgerDonation, type DonationRow } from "./donor-bridge-donations";

/**
 * Per-donor BMC verification gate.
 *
 * Sentry only ever sees BMC donations through `BmcBridgePublication`. A donor's
 * rows are republished together, in one database transaction, only when that
 * donor's complete BMC history (every monthly renewal and one-time payment of
 * every linked supporter) reconciles exactly with the ledger: each paid charge
 * has exactly one approved, confirmed ledger row with the same amount and
 * currency; every active ledger row is a paid charge; refunds are applied;
 * and the totals per currency agree. Any conflict or incomplete check leaves
 * the previous publication untouched and records why.
 */

export type GateIssueCode =
  | "TELEGRAM_ID_REQUIRED" | "SUPPORTER_LINK_REQUIRED" | "SUBSCRIPTION_NOT_RETURNED"
  | "PAYMENT_NOT_RETURNED_BY_BMC" | "UNSUPPORTED_AMOUNT_OR_CURRENCY" | "DUPLICATE_LEDGER_ROWS"
  | "DUPLICATE_HISTORY_CLAIM" | "REFUND_NOT_APPLIED" | "PAYMENT_MISSING_FROM_LEDGER" | "DONOR_CONFLICT"
  | "PAYMENT_AWAITING_APPROVAL" | "PAYMENT_NOT_APPROVED" | "PAID_PAYMENT_REVERSED_IN_LEDGER"
  | "HISTORY_LINK_MISSING" | "LEDGER_REVIEW_PENDING" | "CURRENCY_MISMATCH" | "AMOUNT_MISMATCH"
  | "FREQUENCY_MISMATCH" | "PAID_DATE_MISMATCH" | "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY" | "PUBLISHED_OWNERSHIP_CHANGED"
  | "TOTAL_MISMATCH" | "VERIFICATION_ERROR";
export type GateIssue = { code: GateIssueCode; supportId?: string; transactionId?: string; currency?: string; warning?: true };

export const GATE_ISSUE_TEXT: Record<GateIssueCode, string> = {
  TELEGRAM_ID_REQUIRED: "Donor has no verified Telegram ID.",
  SUPPORTER_LINK_REQUIRED: "Ledger has BMC payments but no BMC supporter is linked to this donor.",
  SUBSCRIPTION_NOT_RETURNED: "BMC did not return one of this donor's subscriptions; its history is incomplete.",
  PAYMENT_NOT_RETURNED_BY_BMC: "A previously recorded BMC charge was not returned by the latest check.",
  UNSUPPORTED_AMOUNT_OR_CURRENCY: "BMC charge is in a currency the ledger cannot hold (only INR/USD) or has a non-positive amount.",
  DUPLICATE_LEDGER_ROWS: "More than one ledger row claims the same BMC charge.",
  DUPLICATE_HISTORY_CLAIM: "One ledger row matches more than one BMC charge.",
  REFUND_NOT_APPLIED: "BMC reports a refund but the ledger row is still active. Void or reverse it.",
  PAYMENT_MISSING_FROM_LEDGER: "Paid BMC charge has no ledger row.",
  DONOR_CONFLICT: "The ledger row for this charge belongs to a different donor.",
  PAYMENT_AWAITING_APPROVAL: "Recovered historical charge is pending approval in Transactions.",
  PAYMENT_NOT_APPROVED: "Ledger row for a paid charge is not approved.",
  PAID_PAYMENT_REVERSED_IN_LEDGER: "BMC shows this charge as paid but the ledger row is voided/reversed.",
  HISTORY_LINK_MISSING: "Ledger row has not been stamped with this BMC charge yet.",
  LEDGER_REVIEW_PENDING: "Ledger row is unconfirmed or has an open BMC review.",
  CURRENCY_MISMATCH: "Ledger currency differs from BMC.",
  AMOUNT_MISMATCH: "Ledger amount differs from BMC.",
  FREQUENCY_MISMATCH: "Ledger frequency (monthly/one-time) differs from BMC.",
  PAID_DATE_MISMATCH: "Ledger BMC paid date differs from BMC's UTC charge date.",
  PUBLISHED_OWNERSHIP_CHANGED: "A payment published for this donor now belongs to someone else in the ledger; it stays published here until the new owner verifies.",
  LEDGER_PAYMENT_NOT_IN_BMC_HISTORY: "Active ledger payment has no matching paid BMC charge (e.g. an unpaid month or a duplicate row). It is not sent to Sentry. Void it if it was never paid.",
  TOTAL_MISMATCH: "Ledger and BMC totals differ.",
  VERIFICATION_ERROR: "Verification could not complete; previous result kept.",
};

export type GateLedgerRow = {
  id: string; amount: { toString(): string }; currency: string; status: string; voidedAt: Date | null; providerState: string;
  fromUserId: string | null; bmcPaymentConfirmed: boolean; bmcReviewReason: string | null; donationFrequency: string;
  bmcHistorySupportId: string | null; bmcHistoryPaymentId: string | null; providerPaymentId: string | null;
  bmcPaidDate: string | null; publishedUserId?: string | null; publishedState?: string | null;
};
export type GateInput = {
  userId: string; telegramId: string | null; supporterIds: string[];
  payments: BmcAccountPayment[]; subscriptions: BmcSubscription[]; rows: GateLedgerRow[];
  unreturnedPaymentIds: ReadonlySet<string>;
};

const reversedRow = (row: GateLedgerRow) => !!row.voidedAt || /REFUND|REVERSE|DISPUTE|FAILED/i.test(row.providerState);
const activeRow = (row: GateLedgerRow) => row.status === "APPROVED" && !reversedRow(row);
const equalAmount = (a: { toString(): string }, b: string) => new Prisma.Decimal(a.toString()).equals(b);
function addTotal(totals: Map<string, Prisma.Decimal>, currency: string, amount: { toString(): string }) {
  totals.set(currency, (totals.get(currency) || new Prisma.Decimal(0)).plus(amount.toString()));
}
const totalsObject = (totals: Map<string, Prisma.Decimal>) => Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => [currency, value.toString()]));

export function evaluateBmcDonorHistory(input: GateInput) {
  const issues: GateIssue[] = [];
  const warnings: GateIssue[] = [];
  if (!input.telegramId || !/^[1-9]\d{0,18}$/.test(input.telegramId)) issues.push({ code: "TELEGRAM_ID_REQUIRED" });
  const supporters = new Set(input.supporterIds);
  for (const subscription of input.subscriptions) {
    if (supporters.has(subscription.supporterId) && subscription.missingFromLatestCheck) issues.push({ code: "SUBSCRIPTION_NOT_RETURNED" });
  }
  const history = input.payments.filter(payment => supporters.has(payment.supporterId));
  const claimed = new Map<string, string>();
  const paid: Array<{ row: GateLedgerRow; payment: BmcAccountPayment }> = [];
  const historyTotals = new Map<string, Prisma.Decimal>();
  for (const payment of history) {
    const at = { supportId: payment.supportId };
    // Claim matching rows first so one problem is reported once, against the charge.
    const matches = input.rows.filter(row => row.bmcHistorySupportId === payment.supportId ||
      (payment.paymentId && (row.providerPaymentId === payment.paymentId || row.bmcHistoryPaymentId === payment.paymentId)));
    for (const row of matches) {
      if (claimed.has(row.id) && claimed.get(row.id) !== payment.supportId) issues.push({ code: "DUPLICATE_HISTORY_CLAIM", ...at, transactionId: row.id });
      claimed.set(row.id, payment.supportId);
    }
    if (input.unreturnedPaymentIds.has(payment.id)) { issues.push({ code: "PAYMENT_NOT_RETURNED_BY_BMC", ...at }); continue; }
    if (!["INR", "USD"].includes(payment.currency) || !(Number(payment.amount) > 0)) { issues.push({ code: "UNSUPPORTED_AMOUNT_OR_CURRENCY", ...at }); continue; }
    if (matches.length > 1) { issues.push({ code: "DUPLICATE_LEDGER_ROWS", ...at }); continue; }
    const row = matches[0];
    if (payment.refundStatus === "REFUNDED") {
      if (row && activeRow(row)) issues.push({ code: "REFUND_NOT_APPLIED", ...at, transactionId: row.id });
      continue;
    }
    addTotal(historyTotals, payment.currency, payment.amount);
    if (!row) { issues.push({ code: "PAYMENT_MISSING_FROM_LEDGER", ...at }); continue; }
    const where = { ...at, transactionId: row.id };
    if (row.fromUserId !== input.userId) { issues.push({ code: "DONOR_CONFLICT", ...where }); continue; }
    if (row.status === "PENDING") { issues.push({ code: "PAYMENT_AWAITING_APPROVAL", ...where }); continue; }
    const before = issues.length;
    if (row.status !== "APPROVED") issues.push({ code: "PAYMENT_NOT_APPROVED", ...where });
    if (reversedRow(row)) issues.push({ code: "PAID_PAYMENT_REVERSED_IN_LEDGER", ...where });
    if (row.bmcHistorySupportId !== payment.supportId) issues.push({ code: "HISTORY_LINK_MISSING", ...where });
    if (!row.bmcPaymentConfirmed || row.bmcReviewReason) issues.push({ code: "LEDGER_REVIEW_PENDING", ...where });
    if (row.currency !== payment.currency) issues.push({ code: "CURRENCY_MISMATCH", ...where });
    else if (!equalAmount(row.amount, payment.amount)) issues.push({ code: "AMOUNT_MISMATCH", ...where });
    if (row.donationFrequency !== payment.frequency) issues.push({ code: "FREQUENCY_MISMATCH", ...where });
    if (row.bmcPaidDate !== payment.occurredAt.slice(0, 10)) issues.push({ code: "PAID_DATE_MISMATCH", ...where });
    if (issues.length === before) paid.push({ row, payment });
  }
  for (const row of input.rows) {
    if (row.publishedUserId === input.userId && row.fromUserId !== input.userId) issues.push({ code: "PUBLISHED_OWNERSHIP_CHANGED", transactionId: row.id });
    if (row.fromUserId !== input.userId || !activeRow(row) || claimed.has(row.id) || !(Number(row.amount.toString()) > 0)) continue;
    if (!supporters.size) { issues.push({ code: "SUPPORTER_LINK_REQUIRED", transactionId: row.id }); continue; }
    // An extra ledger row BMC never charged (duplicate, unpaid month, or a
    // charge BMC has not listed yet) is simply not published: Sentry still gets
    // exactly BMC's paid charges. It holds the donor only if Sentry was already
    // told it was paid, because withdrawing that needs a human decision.
    if (row.publishedState === "PAID") issues.push({ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: row.id });
    else warnings.push({ code: "LEDGER_PAYMENT_NOT_IN_BMC_HISTORY", transactionId: row.id, warning: true });
  }
  const ledgerTotals = new Map<string, Prisma.Decimal>();
  for (const { row } of paid) addTotal(ledgerTotals, row.currency, row.amount);
  const totals = totalsObject(ledgerTotals), expected = totalsObject(historyTotals);
  if (!issues.length && JSON.stringify(totals) !== JSON.stringify(expected)) issues.push({ code: "TOTAL_MISMATCH" });
  return { verified: issues.length === 0, issues, warnings, paid, totals, expectedTotals: expected };
}

type PublishedRow = DonationRow & GateLedgerRow & { status: string; bmcBridgePublication: { fingerprint: string; userId: string; state: string } | null };

const fingerprint = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** The frozen record Sentry reads. Contains no run timestamps, so unchanged facts never re-notify. */
export function publicationPayload(row: DonationRow, verdict: { kind: "PAID"; paidOn: string } | { kind: "REVERSED"; reason: string }) {
  const base = serializeLedgerDonation(row);
  if (verdict.kind === "PAID") return { ...base, paymentDate: verdict.paidOn, paymentDateTimeZone: "UTC",
    state: "PAID" as const, lifecycle: "ACTIVE", paymentConfirmed: true, verificationStatus: "CONFIRMED", xpEligible: true,
    reviewReason: null, reversalReason: null, verification: "BMC_COMPLETE_HISTORY" };
  return { ...base, state: "REVERSED" as const, lifecycle: row.voidedAt ? "VOIDED" : "ACTIVE", paymentConfirmed: false,
    verificationStatus: "REVERSED", xpEligible: false, reviewReason: null, reversalReason: verdict.reason, verification: "BMC_COMPLETE_HISTORY" };
}

type Snapshot = { fetchedAt: string; coverage: readonly string[]; payments: BmcAccountPayment[]; subscriptions: BmcSubscription[]; reviews: Array<{ id: string; reason: string }> };

async function verifyDonor(userId: string, snapshot: Snapshot, runId: string) {
  return prisma.$transaction(async db => {
    // Same lock as webhook/history writers: no BMC ledger write interleaves with this publish.
    await db.$queryRaw`SELECT 1::int AS acquired FROM pg_advisory_xact_lock(hashtext('sentinel-bmc-history'))`;
    const now = new Date();
    const user = await db.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
    if (!user) return { status: "SKIPPED" as const, changed: 0 };
    const links = await db.bmcSupporterLink.findMany({ where: { accountSlug: bmcAccountSlug(), userId }, select: { supporterId: true } });
    const supporterIds = links.map(link => link.supporterId);
    const history = snapshot.payments.filter(payment => supporterIds.includes(payment.supporterId));
    const supportIds = history.map(payment => payment.supportId);
    const paymentIds = history.flatMap(payment => payment.paymentId ? [payment.paymentId] : []);
    const rows = await db.transaction.findMany({
      where: { method: "BMC", type: "DONATION", direction: "IN", isTest: false, OR: [
        { fromUserId: userId }, { bmcHistorySupportId: { in: supportIds } }, { bmcBridgePublication: { is: { userId } } },
        { providerPaymentId: { in: paymentIds } }, { bmcHistoryPaymentId: { in: paymentIds } },
      ] },
      select: { ...donationSelect, status: true, fromUserId: true, bmcBridgePublication: { select: { fingerprint: true, userId: true, state: true } } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }).then(found => found.map(row => ({ ...row, publishedUserId: row.bmcBridgePublication?.userId || null, publishedState: row.bmcBridgePublication?.state || null }))) as unknown as PublishedRow[];
    const unreturned = new Set(snapshot.reviews.filter(review => review.reason === "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED").map(review => review.id));
    const result = evaluateBmcDonorHistory({ userId, telegramId: user.telegramId, supporterIds, payments: snapshot.payments, subscriptions: snapshot.subscriptions, rows, unreturnedPaymentIds: unreturned });
    const common = { telegramId: user.telegramId, lastAttemptAt: now, historyFetchedAt: new Date(snapshot.fetchedAt) };
    if (!result.verified) {
      await db.bmcDonorVerification.upsert({ where: { userId },
        create: { userId, ...common, status: "BLOCKED", issues: result.issues },
        update: { ...common, status: "BLOCKED", issues: result.issues } });
      return { status: "BLOCKED" as const, changed: 0, issues: result.issues };
    }
    const paidIds = new Map(result.paid.map(({ row, payment }) => [row.id, payment]));
    let changed = 0;
    for (const row of rows) {
      if (row.fromUserId !== userId) continue;
      const payment = paidIds.get(row.id);
      // Never-paid, never-published rows (pending or rejected entries) stay invisible.
      if (!payment && row.status !== "APPROVED" && !row.bmcBridgePublication) continue;
      // Extra row BMC never charged and Sentry was never told about: stays unpublished.
      if (!payment && !reversedRow(row) && row.status === "APPROVED") continue;
      const payload = payment
        ? publicationPayload(row, { kind: "PAID", paidOn: payment.occurredAt.slice(0, 10) })
          : publicationPayload(row, { kind: "REVERSED", reason: row.voidReason || (row.voidedAt ? "Voided in Sentinel" : row.status !== "APPROVED" ? "Removed from the approved ledger" : row.providerState) || "Not a paid charge in verified BMC history" });
      const print = fingerprint(payload);
      if (row.bmcBridgePublication?.fingerprint === print && row.bmcBridgePublication.userId === userId) continue;
      const data = { userId, telegramId: user.telegramId!, state: payload.state, amount: row.amount.toString(), currency: row.currency,
        occurredAt: row.date, frequency: row.donationFrequency, payload: payload as unknown as Prisma.InputJsonValue, fingerprint: print, runId, publishedAt: now };
      await db.bmcBridgePublication.upsert({ where: { transactionId: row.id }, create: { transactionId: row.id, ...data }, update: data });
      changed++;
    }
    // Read back what Sentry will now see and prove it equals the verified history.
    const stored = await db.bmcBridgePublication.groupBy({ by: ["currency"], orderBy: { currency: "asc" }, where: { userId, state: "PAID" }, _count: { _all: true }, _sum: { amount: true } });
    const storedTotals = Object.fromEntries(stored.map(row => [row.currency, new Prisma.Decimal(row._sum.amount?.toString() || "0").toString()]));
    const storedCount = stored.reduce((sum, row) => sum + row._count._all, 0);
    if (JSON.stringify(storedTotals) !== JSON.stringify(result.totals) || storedCount !== result.paid.length) throw new Error("Published totals do not match verified BMC history");
    const verified = { ...common, status: "VERIFIED", issues: result.warnings, lastVerifiedAt: now, verifiedTotals: result.totals, verifiedCount: result.paid.length, publishedRunId: runId };
    await db.bmcDonorVerification.upsert({ where: { userId }, create: { userId, ...verified }, update: verified });
    return { status: "VERIFIED" as const, changed };
  }, { maxWait: 10_000, timeout: 30_000 });
}

/** Run after a complete, successful history download. Never call with a stale or partial snapshot. */
export async function publishVerifiedBmcDonors(snapshot: Snapshot) {
  if (!["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"].every(kind => snapshot.coverage.includes(kind))) throw new Error("Incomplete BMC history coverage");
  const runId = randomUUID();
  const [links, owners] = await Promise.all([
    prisma.bmcSupporterLink.findMany({ where: { accountSlug: bmcAccountSlug() }, select: { userId: true } }),
    prisma.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", isTest: false, fromUserId: { not: null } }, distinct: ["fromUserId"], select: { fromUserId: true } }),
  ]);
  const userIds = [...new Set([...links.map(link => link.userId), ...owners.map(owner => owner.fromUserId!)])].sort();
  const summary = { runId, verified: 0, blocked: 0, failed: 0, published: 0, newlyBlocked: [] as string[] };
  const before = new Map((await prisma.bmcDonorVerification.findMany({ select: { userId: true, status: true } })).map(row => [row.userId, row.status]));
  for (const userId of userIds) {
    try {
      const result = await verifyDonor(userId, snapshot, runId);
      if (result.status === "VERIFIED") { summary.verified++; summary.published += result.changed; }
      if (result.status === "BLOCKED") { summary.blocked++; if (before.get(userId) !== "BLOCKED") summary.newlyBlocked.push(userId); }
    } catch {
      summary.failed++;
      // Previous publication is untouched; record the failed attempt if possible.
      await prisma.bmcDonorVerification.upsert({ where: { userId },
        create: { userId, status: "BLOCKED", issues: [{ code: "VERIFICATION_ERROR" }], lastAttemptAt: new Date() },
        update: { status: "BLOCKED", issues: [{ code: "VERIFICATION_ERROR" }], lastAttemptAt: new Date() } }).catch(() => undefined);
    }
  }
  return summary;
}

export async function bmcDonorVerificationList() {
  const rows = await prisma.bmcDonorVerification.findMany({ orderBy: [{ status: "asc" }, { lastAttemptAt: "desc" }],
    select: { userId: true, status: true, issues: true, lastAttemptAt: true, lastVerifiedAt: true, verifiedTotals: true, verifiedCount: true, user: { select: { name: true } } } });
  return rows.map(row => ({ userId: row.userId, name: row.user.name, status: row.status, lastAttemptAt: row.lastAttemptAt.toISOString(),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() || null, verifiedTotals: row.verifiedTotals, verifiedCount: row.verifiedCount,
    issues: (Array.isArray(row.issues) ? row.issues as GateIssue[] : []).map(issue => ({ ...issue, text: GATE_ISSUE_TEXT[issue.code] || issue.code })) }));
}
