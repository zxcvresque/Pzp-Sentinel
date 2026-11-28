import { mkdir, rm, stat, utimes } from "node:fs/promises";
import { prisma } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { bmcAccountSlug } from "./bmc-attribution";
import { bmcDashboardSession, BmcHistoryError } from "./bmc-history";
import { fetchEntireBmcAccountHistory, type BmcAccountPayment, type BmcSubscription } from "./bmc-account-history";
import { bmcDataDirectory, bmcPrivatePath, readBmcPrivate, writeBmcPrivate } from "./bmc-private-store";
import { encryptSecret } from "./secret-crypto";
import { notifyAdmins } from "./notifications";
import { monthlyReminderUpdate } from "./donation-frequency";
import { bmcTransactionKeys } from "./bmc-webhook";
import { bmcSyncFailure, type BmcSyncStage } from "./bmc-sync-error";
import { publishVerifiedBmcDonors } from "./bmc-donor-gate";

export type BmcHistoryReview = { id: string; reason: string; transactionId?: string };
export type BmcHistorySnapshot = {
  accountSlug: string; fetchedAt: string; coverage: readonly string[];
  subscriptions: BmcSubscription[]; payments: BmcAccountPayment[]; reviews: BmcHistoryReview[];
};
export type BmcBridgeSummary = { verified: number; blocked: number; failed: number; published: number };
export type BmcSyncHealth = { lastAttemptAt: string; lastSuccessAt?: string; errorCode?: string; error?: string; failedStage?: BmcSyncStage; diagnosticCode?: string; diagnosticDetail?: string; reviewed?: number; confirmed?: number; recovered?: number; bridge?: BmcBridgeSummary; lastPublishedAt?: string };
const snapshotPath = () => bmcPrivatePath("history.enc");
const healthPath = () => bmcPrivatePath("health.enc");
export async function readBmcHistorySnapshot() {
  const snapshot = await readBmcPrivate<BmcHistorySnapshot>(snapshotPath());
  return snapshot?.accountSlug === bmcAccountSlug() ? snapshot : null;
}
export async function bmcHistoryHealth() {
  const [health, snapshot] = await Promise.all([readBmcPrivate<BmcSyncHealth>(healthPath()), readBmcHistorySnapshot()]);
  const lock = await stat(bmcPrivatePath("sync.lock")).catch(() => null);
  return { ...health, syncing: Boolean(lock && Date.now() - lock.mtimeMs < 20 * 60_000), lastSuccessAt: snapshot?.fetchedAt || null,
    paymentCount: snapshot?.payments.length || 0, reviewCount: snapshot?.reviews.length || 0,
    notInBmcCount: await prisma.transaction.count({ where: { method: "BMC", status: "APPROVED", voidedAt: null, isTest: false, bmcReviewReason: NOT_IN_BMC_HISTORY } }).catch(() => null),
    subscriptions: snapshot?.subscriptions.length || 0, cancelledSubscriptions: snapshot?.subscriptions.filter(row => row.status === "CANCELLED").length || 0, coverage: snapshot?.coverage || [] };
}

type Candidate = { id: string; amount: { toString(): string }; currency: string; donationFrequency: string; date: Date; bmcEventId: string | null; providerPaymentId: string | null; bmcHistoryPaymentId?: string | null; bmcHistorySupportId?: string | null; bmcPaidDate?: string | null; bmcSupporterAmount?: { toString(): string } | null; bmcSupporterCurrency?: string | null; bmcReviewReason?: string | null; fromUserId: string | null; voidedAt: Date | null; status: string; providerState: string; bmcPaymentConfirmed: boolean };
// Display-only: what the supporter paid in their own currency, from BMC history.
const supporterFields = (payment: BmcAccountPayment) => ({
  bmcSupporterAmount: payment.supporterPaid?.amount ?? null, bmcSupporterCurrency: payment.supporterPaid?.currency ?? null });

// Monthly webhook rows carry their billing-period start in the event key
// (`…_period_<unix seconds>`). That is the provider's own fact about which month
// a row is for, even when the row's date was written wrongly.
function billingPeriodStart(eventId: string | null) {
  const seconds = eventId?.match(/_period_(\d{9,11})$/)?.[1];
  return seconds ? Number(seconds) * 1000 : null;
}

export function matchBmcHistoryPayment(payment: BmcAccountPayment, candidates: Candidate[], linkedUserId: string | null) {
  const exact = candidates.filter(tx => (payment.paymentId && (tx.providerPaymentId === payment.paymentId || tx.bmcHistoryPaymentId === payment.paymentId)) || tx.bmcHistorySupportId === payment.supportId || (payment.frequency === "ONE_TIME" && bmcTransactionKeys("donation.created", payment.supportId).includes(tx.bmcEventId || "")));
  // A row already claimed by a different BMC charge is never a candidate for this one.
  const plausible = candidates.filter(tx => tx.donationFrequency === payment.frequency && Math.abs(tx.date.getTime() - Date.parse(payment.occurredAt)) <= 36 * 3600_000 &&
    !(tx.bmcHistorySupportId && tx.bmcHistorySupportId !== payment.supportId) &&
    // A row for a different billing period is not this charge, whatever its date says.
    !(payment.frequency === "MONTHLY" && billingPeriodStart(tx.bmcEventId) !== null && Math.abs(billingPeriodStart(tx.bmcEventId)! - Date.parse(payment.occurredAt)) > 36 * 3600_000) &&
    ((payment.stripeSubscriptionId && tx.bmcEventId?.includes(payment.stripeSubscriptionId)) || (linkedUserId && tx.fromUserId === linkedUserId)));
  // An already-voided duplicate beside exactly one live row does not make the
  // match ambiguous; two live rows still do (one of them is an extra credit).
  const live = plausible.filter(tx => !tx.voidedAt);
  const matches = exact.length ? exact : plausible.length > 1 && live.length === 1 ? live : plausible;
  if (matches.length > 1) return { kind: "REVIEW", reason: "AMBIGUOUS_MATCH", candidateIds: matches.map(tx => tx.id) } as const;
  if (!matches.length) return { kind: "MISSING" } as const;
  const tx = matches[0];
  if (Math.abs(tx.date.getTime() - Date.parse(payment.occurredAt)) > 36 * 3600_000 || tx.donationFrequency !== payment.frequency) return { kind: "REVIEW", reason: "DATE_OR_FREQUENCY_MISMATCH", transactionId: tx.id } as const;
  if (tx.status === "PENDING" && tx.bmcPaymentConfirmed && tx.bmcHistorySupportId === payment.supportId && tx.bmcHistoryPaymentId === payment.paymentId && !tx.voidedAt) return { kind: "REVIEW", reason: "HISTORICAL_PAYMENT_REQUIRES_APPROVAL", transactionId: tx.id } as const;
  if (tx.voidedAt || tx.status !== "APPROVED" || /REFUND|REVERSE|DISPUTE|FAILED/i.test(tx.providerState)) return { kind: "REVIEW", reason: "LEDGER_CONFLICT", transactionId: tx.id } as const;
  if (tx.currency !== payment.currency || !new Prisma.Decimal(tx.amount.toString()).equals(payment.amount) || (tx.providerPaymentId && tx.providerPaymentId !== payment.paymentId) || (tx.bmcHistoryPaymentId && tx.bmcHistoryPaymentId !== payment.paymentId) || (tx.bmcHistorySupportId && tx.bmcHistorySupportId !== payment.supportId)) return { kind: "REVIEW", reason: "AMOUNT_OR_REFERENCE_MISMATCH", transactionId: tx.id } as const;
  if (linkedUserId && tx.fromUserId && tx.fromUserId !== linkedUserId) return { kind: "REVIEW", reason: "DONOR_CONFLICT", transactionId: tx.id } as const;
  return { kind: "MATCH", transaction: tx } as const;
}

async function reconcileHistory(payments: BmcAccountPayment[], actorId: string, generation: string, automaticFrom: string) {
  const reviews: BmcHistoryReview[] = [];
  const matchedIds = new Set<string>();
  // Rows BMC does have a charge for, but which could not be settled (ambiguous):
  // never flagged as "not in BMC records".
  const contestedIds = new Set<string>();
  let confirmed = 0;
  let recovered = 0;
  for (const payment of payments) {
    if ((await bmcDashboardSession()).generation !== generation) throw new BmcHistoryError("CONNECTION_CHANGED", "BMC was disconnected or reconnected during sync. Run sync again.", 409);
    if (!["INR", "USD"].includes(payment.currency) || Number(payment.amount) <= 0) { reviews.push({ id: payment.id, reason: "UNSUPPORTED_AMOUNT_OR_CURRENCY" }); continue; }
    await prisma.$transaction(async db => {
      // Serialize against other history reconciliation runs at the database level.
      // The lock function returns PostgreSQL void, which Prisma cannot decode.
      // Acquire the same transaction-scoped lock while returning an integer.
      await db.$queryRaw<Array<{ acquired: number }>>`SELECT 1::int AS acquired FROM pg_advisory_xact_lock(hashtext('sentinel-bmc-history'))`;
      const link = await db.bmcSupporterLink.findUnique({ where: { accountSlug_supporterId: { accountSlug: bmcAccountSlug(), supporterId: payment.supporterId } } });
      const when = Date.parse(payment.occurredAt);
      const candidates = await db.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", isTest: false,
        OR: [...(payment.paymentId ? [{ providerPaymentId: payment.paymentId }, { bmcHistoryPaymentId: payment.paymentId }] : []),
          { bmcHistorySupportId: payment.supportId },
          { date: { gte: new Date(when - 36 * 3600_000), lte: new Date(when + 36 * 3600_000) } }] } });
      const result = matchBmcHistoryPayment(payment, candidates, link?.userId || null);
      if (payment.refundStatus === "REFUNDED") {
        const transactionId = result.kind === "MATCH" ? result.transaction.id : "transactionId" in result ? result.transactionId : undefined;
        const refunded = candidates.find(tx => tx.id === transactionId);
        // Already voided/reversed in the ledger: the refund is applied, nothing to review.
        if (refunded && (refunded.voidedAt || /REFUND|REVERSE|DISPUTE|FAILED/i.test(refunded.providerState))) { matchedIds.add(refunded.id); return; }
        if (transactionId) {
          matchedIds.add(transactionId);
          const held = await db.transaction.updateMany({ where: { id: transactionId, method: "BMC", OR: [{ bmcReviewReason: null }, { bmcReviewReason: { not: "PROVIDER_REFUND_REQUIRES_REVIEW" } }] }, data: { bmcReviewReason: "PROVIDER_REFUND_REQUIRES_REVIEW" } });
          if (held.count) await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_REFUND_REVIEW", entityType: "Transaction", entityId: transactionId, transactionId,
            after: { source: payment.evidenceSource, supportId: payment.supportId, paymentId: payment.paymentId, reason: "PROVIDER_REFUND_REQUIRES_REVIEW" } } });
        }
        reviews.push({ id: payment.id, reason: "PROVIDER_REFUND_REQUIRES_REVIEW", ...(transactionId ? { transactionId } : {}) });
        return;
      }
      if (result.kind === "REVIEW" && "candidateIds" in result) for (const id of result.candidateIds || []) contestedIds.add(id);
      if (result.kind === "REVIEW") { reviews.push({ id: payment.id, reason: result.reason, ...("transactionId" in result ? { transactionId: result.transactionId } : {}) }); return; }
      if (result.kind === "MATCH") {
        const tx = result.transaction;
        matchedIds.add(tx.id);
        if (tx.bmcReviewReason === "PROVIDER_REFUND_REQUIRES_REVIEW" && payment.refundStatus !== "NOT_REFUNDED") {
          reviews.push({ id: payment.id, reason: "PROVIDER_REFUND_REQUIRES_REVIEW", transactionId: tx.id });
          return;
        }
        const paidDate = payment.occurredAt.slice(0, 10);
        const supporter = supporterFields(payment);
        if (tx.bmcReviewReason || !tx.bmcPaymentConfirmed || tx.bmcHistoryPaymentId !== payment.paymentId || tx.bmcHistorySupportId !== payment.supportId || tx.bmcPaidDate !== paidDate || (!tx.fromUserId && link?.userId) ||
          (tx.bmcSupporterAmount?.toString() ?? null) !== (supporter.bmcSupporterAmount === null ? null : new Prisma.Decimal(supporter.bmcSupporterAmount).toString()) || (tx.bmcSupporterCurrency ?? null) !== supporter.bmcSupporterCurrency) {
          // A concurrent void/refund must win. Never resurrect a reversed entry.
          const changed = await db.transaction.updateMany({ where: { id: tx.id, voidedAt: null, status: "APPROVED", providerState: tx.providerState, bmcPaymentConfirmed: tx.bmcPaymentConfirmed,
            fromUserId: tx.fromUserId, providerPaymentId: tx.providerPaymentId, amount: tx.amount.toString(), currency: tx.currency as "INR" | "USD", date: tx.date },
            data: { bmcPaymentConfirmed: true, providerVerified: true, bmcReviewReason: null, bmcHistoryPaymentId: payment.paymentId,
              bmcHistorySupportId: payment.supportId, bmcPaidDate: paidDate, ...supporter, fromUserId: tx.fromUserId || link?.userId || null, providerState: "CAPTURED" } });
          if (changed.count) {
            await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_CONFIRMED", entityType: "Transaction", entityId: tx.id, transactionId: tx.id,
              after: { source: payment.evidenceSource, supportId: payment.supportId, paymentId: payment.paymentId } } });
            if (!tx.bmcPaymentConfirmed) confirmed++;
          } else reviews.push({ id: payment.id, reason: "LEDGER_CHANGED_DURING_SYNC", transactionId: tx.id });
        }
        return;
      }
      // With no exact donor/payment mapping, keep the source evidence for review.
      // A nearby ledger entry might have a currency conversion or older identity.
      if (!link || !payment.paymentId || candidates.length) { reviews.push({ id: payment.id, reason: candidates.length ? "POSSIBLE_EXISTING_PAYMENT" : "DONOR_OR_PAYMENT_REFERENCE_REQUIRED" }); return; }
      // Historical discoveries may already have XP under an older ledger entry.
      // Keep verified evidence, but require review before publishing new awards.
      const historical = Date.parse(payment.occurredAt) < Date.parse(automaticFrom);
      const tx = await db.transaction.create({ data: {
        amount: payment.amount, currency: payment.currency as "INR" | "USD", method: "BMC", type: "DONATION", direction: "IN", status: historical ? "PENDING" : "APPROVED",
        donationFrequency: payment.frequency, date: new Date(payment.occurredAt), fromUserId: link.userId, createdById: actorId,
        providerPaymentId: payment.paymentId, bmcHistoryPaymentId: payment.paymentId, bmcHistorySupportId: payment.supportId, bmcPaidDate: payment.occurredAt.slice(0, 10), ...supporterFields(payment), providerVerified: true, bmcPaymentConfirmed: true, providerState: "CAPTURED",
        bmcEventId: payment.frequency === "ONE_TIME" ? bmcTransactionKeys("donation.created", payment.supportId)[0] : `bmc_history_${bmcAccountSlug()}_${payment.supportId}`,
        description: `BMC ${payment.frequency === "MONTHLY" ? "monthly" : "one-time"} payment recovered from account history`,
        providerDetailsEncrypted: encryptSecret(JSON.stringify({ ...payment, source: "BMC_DASHBOARD_HISTORY" })),
      } });
      const reminder = monthlyReminderUpdate(payment.frequency, new Date(payment.occurredAt));
      if (reminder && !historical) await db.user.updateMany({ where: { id: link.userId, OR: [{ donateReminderAnchorAt: null }, { donateReminderAnchorAt: { lt: new Date(payment.occurredAt) } }] }, data: reminder });
      await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_RECOVERED", entityType: "Transaction", entityId: tx.id, transactionId: tx.id, after: { supportId: payment.supportId, source: payment.evidenceSource } } });
      if (historical) reviews.push({ id: payment.id, reason: "HISTORICAL_PAYMENT_REQUIRES_APPROVAL", transactionId: tx.id });
      recovered++;
      matchedIds.add(tx.id);
    }, { maxWait: 10000, timeout: 20000 });
  }
  return { reviews, confirmed, recovered, matchedIds, contestedIds };
}

/** How long a newly recorded BMC payment may be absent from BMC's history before it is flagged. */
export const BMC_LISTING_GRACE_MS = 60 * 60_000;

const WEBHOOK_CHECK_DELAY_MS = 30_000;
const FOLLOW_UP_DELAY_MS = 2 * 60_000;
const MAX_FOLLOW_UPS = 5;
let pendingCheck: ReturnType<typeof setTimeout> | null = null;
let runningCheck: Promise<void> | null = null;
let followUps = 0;

/** Resolves when a webhook-requested check that is running now has finished (and scheduled any follow-up). */
export function bmcHistoryCheckSettled() {
  return runningCheck || Promise.resolve();
}

/**
 * Check BMC history soon after BMC reports activity (a signed webhook) instead
 * of waiting for the 15-minute schedule, so a verified payment reaches Sentry
 * within about a minute. Bursts collapse into one check. It checks again a few
 * times if another check held the lock or the new payment is not listed by BMC
 * yet. The 15-minute schedule remains the backstop. Returns false if a check
 * is already scheduled.
 */
export function requestBmcHistoryCheck(delayMs = WEBHOOK_CHECK_DELAY_MS) {
  if (pendingCheck) return false;
  pendingCheck = setTimeout(() => {
    pendingCheck = null;
    runningCheck = syncBmcAccountHistory().then(result => {
      const retry = "skipped" in result || ("awaitingBmc" in result && (result.awaitingBmc ?? 0) > 0);
      if (retry && followUps < MAX_FOLLOW_UPS) { followUps++; requestBmcHistoryCheck(FOLLOW_UP_DELAY_MS); }
      else followUps = 0;
    }, () => { followUps = 0; }).finally(() => { runningCheck = null; });
  }, delayMs);
  pendingCheck.unref?.();
  return true;
}

/** Stored on a ledger row whose payment BMC's complete history does not contain. */
export const NOT_IN_BMC_HISTORY = "NOT_IN_BMC_HISTORY";

// BMC is the source of truth. Flag every active BMC ledger row that no BMC charge
// accounts for, and clear the flag from rows BMC now accounts for. Never voids:
// that stays an admin decision. Returns the newly flagged row IDs.
async function flagLedgerRowsMissingFromBmc(missing: string[], accounted: string[], actorId: string, generation: string) {
  return prisma.$transaction(async db => {
    await db.$queryRaw<Array<{ acquired: number }>>`SELECT 1::int AS acquired FROM pg_advisory_xact_lock(hashtext('sentinel-bmc-history'))`;
    if ((await bmcDashboardSession()).generation !== generation) throw new BmcHistoryError("CONNECTION_CHANGED", "BMC was disconnected or reconnected during sync. Run sync again.", 409);
    // A row already under a more specific review (e.g. a refund) keeps that reason.
    const flag = missing.length ? await db.transaction.findMany({ where: { id: { in: missing }, method: "BMC", status: "APPROVED", voidedAt: null, bmcReviewReason: null }, select: { id: true } }) : [];
    if (flag.length) {
      await db.transaction.updateMany({ where: { id: { in: flag.map(row => row.id) }, status: "APPROVED", voidedAt: null, bmcReviewReason: null }, data: { bmcReviewReason: NOT_IN_BMC_HISTORY } });
      for (const row of flag) await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_NOT_FOUND", entityType: "Transaction", entityId: row.id, transactionId: row.id, after: { reason: NOT_IN_BMC_HISTORY } } });
    }
    if (accounted.length) await db.transaction.updateMany({ where: { id: { in: accounted }, bmcReviewReason: NOT_IN_BMC_HISTORY }, data: { bmcReviewReason: null } });
    return flag.map(row => row.id);
  }, { maxWait: 10000, timeout: 20000 });
}

export async function syncBmcAccountHistory() {
  await mkdir(bmcDataDirectory(), { recursive: true, mode: 0o700 });
  const lock = bmcPrivatePath("sync.lock");
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const info = await stat(lock).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 20 * 60_000) { await rm(lock, { recursive: true, force: true }); return syncBmcAccountHistory(); }
    return { skipped: true };
  }
  let previous: BmcSyncHealth | null = null;
  const heartbeat = setInterval(() => { const now = new Date(); void utimes(lock, now, now).catch(() => undefined); }, 30_000);
  heartbeat.unref();
  const attempt = new Date().toISOString();
  let stage: BmcSyncStage = "LOAD_SESSION";
  try {
    previous = await readBmcPrivate<BmcSyncHealth>(healthPath());
    const session = await bmcDashboardSession();
    if (!session.generation || !session.connectedBy || session.accountSlug !== bmcAccountSlug() || !session.studioCookie) throw new BmcHistoryError("SESSION_NOT_CONFIGURED", "Import your Helium BMC session in Sentinel to enable automatic verification.", 503);
    const old = await readBmcHistorySnapshot();
    stage = "FETCH_HISTORY";
    const result = await fetchEntireBmcAccountHistory(session);
    if ((await bmcDashboardSession()).generation !== session.generation) throw new BmcHistoryError("CONNECTION_CHANGED", "The BMC connection changed during sync. Try again.", 409);
    // A signed-out studio/app session can answer with empty lists rather than an
    // error. Never let that masquerade as an account whose payments vanished.
    for (const kind of ["MONTHLY", "ONE_TIME"] as const) {
      const before = old?.payments.filter(row => row.frequency === kind).length || 0;
      if (before && !result.payments.some(row => row.frequency === kind)) throw new BmcHistoryError("SESSION_EXPIRED", `BMC returned no ${kind === "MONTHLY" ? "monthly" : "one-time"} payments although ${before} were recorded before. The session is probably signed out; import a fresh Helium session. Nothing was changed.`, 503, `${kind.toLowerCase()} history empty`);
    }
    stage = "RECONCILE_LEDGER";
    const reconciliation = await reconcileHistory(result.payments, session.connectedBy, session.generation, old?.fetchedAt || attempt);
    // Compare both ways. BMC is the source of truth: every active BMC ledger row
    // (whatever created it: webhook, history recovery or a manual entry) must be
    // a charge in BMC's complete history. Flag the rest without voiding them.
    const ledger = await prisma.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", status: "APPROVED", isTest: false, voidedAt: null },
      select: { id: true, providerState: true, createdAt: true } });
    const accounted = (id: string) => reconciliation.matchedIds.has(id) || reconciliation.contestedIds.has(id) || reconciliation.reviews.some(review => review.transactionId === id);
    const unaccounted = ledger.filter(tx => !accounted(tx.id) && !/REFUND|REVERSE|DISPUTE|FAILED/i.test(tx.providerState));
    // A payment recorded moments ago (e.g. from a webhook) may not be in BMC's
    // list yet: it is awaiting BMC, not missing. It stays unpublished meanwhile.
    const listedBy = Date.now() - BMC_LISTING_GRACE_MS;
    const awaitingBmc = unaccounted.filter(tx => (tx.createdAt?.getTime() ?? 0) > listedBy).length;
    const missingLedger = unaccounted.filter(tx => (tx.createdAt?.getTime() ?? 0) <= listedBy)
      .map(tx => ({ id: `ledger:${tx.id}`, reason: "LEDGER_PAYMENT_NOT_RETURNED", transactionId: tx.id }));
    const newlyNotInBmc = await flagLedgerRowsMissingFromBmc(missingLedger.map(row => row.transactionId), ledger.filter(tx => accounted(tx.id)).map(tx => tx.id), session.connectedBy, session.generation);
    const disappeared = (old?.payments || []).filter(p => !result.payments.some(row => row.id === p.id));
    const missingSubscriptions = (old?.subscriptions || []).filter(subscription => !result.subscriptions.some(row => row.id === subscription.id));
    const subscriptions = [...result.subscriptions.map(subscription => ({ ...subscription, lastSeenAt: result.fetchedAt, missingFromLatestCheck: false })),
      ...missingSubscriptions.map(subscription => ({ ...subscription, lastSeenAt: subscription.lastSeenAt || old?.fetchedAt, missingFromLatestCheck: true }))];
    const reviews = [...reconciliation.reviews, ...missingLedger, ...disappeared.map(p => ({ id: p.id, reason: "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED" }))];
    stage = "SAVE_HISTORY";
    await writeBmcPrivate(snapshotPath(), { ...result, subscriptions, accountSlug: session.accountSlug, payments: [...result.payments, ...disappeared], reviews });
    stage = "PUBLISH_BRIDGE";
    if ((await bmcDashboardSession()).generation !== session.generation) throw new BmcHistoryError("CONNECTION_CHANGED", "The BMC connection changed before publication. Run another check.", 409);
    // Per-donor all-or-nothing publication to the Sentry bridge.
    const gate = await publishVerifiedBmcDonors({ fetchedAt: result.fetchedAt, coverage: result.coverage, subscriptions, reviews, payments: [...result.payments, ...disappeared] });
    const bridge = { verified: gate.verified, blocked: gate.blocked, failed: gate.failed, published: gate.published };
    await writeBmcPrivate(healthPath(), { lastAttemptAt: attempt, lastSuccessAt: result.fetchedAt, reviewed: reviews.length, confirmed: reconciliation.confirmed, recovered: reconciliation.recovered, bridge, lastPublishedAt: new Date().toISOString() });
    stage = "NOTIFY_ADMINS";
    const newReviews = reviews.filter(row => !old?.reviews.some(prior => prior.id === row.id && prior.reason === row.reason));
    const lifecycleChanges = old ? result.subscriptions.filter(row => {
      const prior = old.subscriptions.find(before => before.id === row.id);
      return prior && prior.status !== row.status;
    }) : [];
    for (const subscription of lifecycleChanges) await notifyAdmins({ type: "SYSTEM", title: "BMC subscription status changed",
      message: `Subscription ${subscription.id}: ${subscription.status === "CANCELLING" ? "cancels at period end" : subscription.status.toLowerCase()}.${subscription.cancelledAt ? ` BMC cancellation time: ${subscription.cancelledAt}.` : ""} Earlier paid transactions remain unchanged.`,
      actionUrl: "/admin/bmc", priority: "HIGH" });
    if (missingSubscriptions.some(subscription => !subscription.missingFromLatestCheck)) await notifyAdmins({ type: "SYSTEM", title: "BMC subscription status unavailable",
      message: "BMC did not return a previously recorded subscription. Its last known status and paid history were retained. Review the account; no cancellation or payment reversal was inferred.", actionUrl: "/admin/bmc", priority: "HIGH" });
    if (newlyNotInBmc.length) await notifyAdmins({ type: "SYSTEM", title: "Ledger payments not in BMC records",
      message: `${newlyNotInBmc.length} BMC ledger payment(s) are not in BMC's own payment history and were flagged "Not in BMC records". They are not sent to Sentry. Void each one that was never paid.`, actionUrl: "/admin/transactions?bmcRecords=NOT_IN_BMC", priority: "HIGH" });
    if (gate.newlyBlocked.length || gate.failed) await notifyAdmins({ type: "SYSTEM", title: "BMC donor verification held",
      message: `${gate.newlyBlocked.length + gate.failed} donor(s) did not pass complete-history verification. Their previously verified Sentry data is unchanged; new BMC updates for them are held until the listed issues are resolved.`, actionUrl: "/admin/bmc", priority: "HIGH" });
    if (newReviews.length || reconciliation.recovered) await notifyAdmins({ type: "SYSTEM", title: "BMC history verification completed", message: `${result.payments.length} recorded payments checked. ${reconciliation.confirmed} confirmed, ${reconciliation.recovered} recovered, ${newReviews.length} new items need review.`, actionUrl: "/admin/bmc", priority: "HIGH" });
    return { checked: result.payments.length, confirmed: reconciliation.confirmed, recovered: reconciliation.recovered, reviews: reviews.length, bridge, awaitingBmc };
  } catch (error) {
    const failure = bmcSyncFailure(error, stage);
    const known = failure.error;
    console.warn("[bmc-history] Verification failed", { stage, code: known.code, diagnosticCode: failure.diagnosticCode });
    await writeBmcPrivate(healthPath(), { lastAttemptAt: attempt, lastSuccessAt: previous?.lastSuccessAt, errorCode: known.code, error: known.message, failedStage: stage, diagnosticCode: failure.diagnosticCode,
      diagnosticDetail: known.detail, bridge: previous?.bridge, lastPublishedAt: previous?.lastPublishedAt });
    if (known.code !== previous?.errorCode && known.code !== "SESSION_NOT_CONFIGURED") await notifyAdmins({ type: "SYSTEM", title: "BMC verification needs attention", message: known.message, actionUrl: "/admin/bmc", priority: "HIGH" });
    return { error: known.message, code: known.code, failedStage: stage, ...(failure.diagnosticCode ? { diagnosticCode: failure.diagnosticCode } : {}) };
  } finally { clearInterval(heartbeat); await rm(lock, { recursive: true, force: true }); }
}
