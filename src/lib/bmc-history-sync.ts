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

export type BmcHistoryReview = { id: string; reason: string; transactionId?: string };
export type BmcHistorySnapshot = {
  accountSlug: string; fetchedAt: string; coverage: readonly string[];
  subscriptions: BmcSubscription[]; payments: BmcAccountPayment[]; reviews: BmcHistoryReview[];
};
export type BmcSyncHealth = { lastAttemptAt: string; lastSuccessAt?: string; errorCode?: string; error?: string; reviewed?: number; confirmed?: number; recovered?: number };
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
    subscriptions: snapshot?.subscriptions.length || 0, cancelledSubscriptions: snapshot?.subscriptions.filter(row => row.status === "CANCELLED").length || 0, coverage: snapshot?.coverage || [] };
}

type Candidate = { id: string; amount: { toString(): string }; currency: string; donationFrequency: string; date: Date; bmcEventId: string | null; providerPaymentId: string | null; fromUserId: string | null; voidedAt: Date | null; status: string; providerState: string; bmcPaymentConfirmed: boolean };
export function matchBmcHistoryPayment(payment: BmcAccountPayment, candidates: Candidate[], linkedUserId: string | null) {
  const exact = candidates.filter(tx => (payment.paymentId && tx.providerPaymentId === payment.paymentId) || (payment.frequency === "ONE_TIME" && bmcTransactionKeys("donation.created", payment.supportId).includes(tx.bmcEventId || "")));
  const plausible = candidates.filter(tx => tx.donationFrequency === payment.frequency && Math.abs(tx.date.getTime() - Date.parse(payment.occurredAt)) <= 36 * 3600_000 &&
    ((payment.stripeSubscriptionId && tx.bmcEventId?.includes(payment.stripeSubscriptionId)) || (linkedUserId && tx.fromUserId === linkedUserId)));
  const matches = exact.length ? exact : plausible;
  if (matches.length > 1) return { kind: "REVIEW", reason: "AMBIGUOUS_MATCH" } as const;
  if (!matches.length) return { kind: "MISSING" } as const;
  const tx = matches[0];
  if (Math.abs(tx.date.getTime() - Date.parse(payment.occurredAt)) > 36 * 3600_000 || tx.donationFrequency !== payment.frequency) return { kind: "REVIEW", reason: "DATE_OR_FREQUENCY_MISMATCH", transactionId: tx.id } as const;
  if (tx.voidedAt || tx.status !== "APPROVED" || ["REFUNDED", "FAILED", "PAYMENT_FAILED"].includes(tx.providerState)) return { kind: "REVIEW", reason: "LEDGER_CONFLICT", transactionId: tx.id } as const;
  if (tx.currency !== payment.currency || !new Prisma.Decimal(tx.amount.toString()).equals(payment.amount) || (tx.providerPaymentId && tx.providerPaymentId !== payment.paymentId)) return { kind: "REVIEW", reason: "AMOUNT_OR_REFERENCE_MISMATCH", transactionId: tx.id } as const;
  if (linkedUserId && tx.fromUserId && tx.fromUserId !== linkedUserId) return { kind: "REVIEW", reason: "DONOR_CONFLICT", transactionId: tx.id } as const;
  return { kind: "MATCH", transaction: tx } as const;
}

async function reconcileHistory(payments: BmcAccountPayment[], actorId: string, generation: string) {
  const reviews: BmcHistoryReview[] = [];
  const matchedIds = new Set<string>();
  let confirmed = 0;
  let recovered = 0;
  for (const payment of payments) {
    if ((await bmcDashboardSession()).generation !== generation) throw new BmcHistoryError("CONNECTION_CHANGED", "BMC was disconnected or reconnected during sync. Run sync again.", 409);
    if (!["INR", "USD"].includes(payment.currency) || Number(payment.amount) <= 0) { reviews.push({ id: payment.id, reason: "UNSUPPORTED_AMOUNT_OR_CURRENCY" }); continue; }
    await prisma.$transaction(async db => {
      // Serialize against other history reconciliation runs at the database level.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sentinel-bmc-history'))`;
      const link = await db.bmcSupporterLink.findUnique({ where: { accountSlug_supporterId: { accountSlug: bmcAccountSlug(), supporterId: payment.supporterId } } });
      const when = Date.parse(payment.occurredAt);
      const candidates = await db.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", isTest: false,
        OR: [...(payment.paymentId ? [{ providerPaymentId: payment.paymentId }] : []),
          { date: { gte: new Date(when - 36 * 3600_000), lte: new Date(when + 36 * 3600_000) } }] } });
      const result = matchBmcHistoryPayment(payment, candidates, link?.userId || null);
      if (payment.refundStatus === "REFUNDED") {
        const transactionId = result.kind === "MATCH" ? result.transaction.id : "transactionId" in result ? result.transactionId : undefined;
        if (transactionId) matchedIds.add(transactionId);
        reviews.push({ id: payment.id, reason: "PROVIDER_REFUND_REQUIRES_REVIEW", ...(transactionId ? { transactionId } : {}) });
        return;
      }
      if (result.kind === "REVIEW") { reviews.push({ id: payment.id, reason: result.reason, ...("transactionId" in result ? { transactionId: result.transactionId } : {}) }); return; }
      if (result.kind === "MATCH") {
        const tx = result.transaction;
        matchedIds.add(tx.id);
        if (!tx.bmcPaymentConfirmed) {
          // A concurrent void/refund must win. Never resurrect a reversed entry.
          const changed = await db.transaction.updateMany({ where: { id: tx.id, voidedAt: null, status: "APPROVED", providerState: tx.providerState, bmcPaymentConfirmed: false,
            fromUserId: tx.fromUserId, providerPaymentId: tx.providerPaymentId, amount: tx.amount.toString(), currency: tx.currency as "INR" | "USD", date: tx.date },
            data: { bmcPaymentConfirmed: true, providerVerified: true, providerPaymentId: payment.paymentId || tx.providerPaymentId, providerState: "CAPTURED" } });
          if (changed.count) {
            await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_CONFIRMED", entityType: "Transaction", entityId: tx.id, transactionId: tx.id,
              after: { source: payment.evidenceSource, supportId: payment.supportId, paymentId: payment.paymentId } } });
            confirmed++;
          } else reviews.push({ id: payment.id, reason: "LEDGER_CHANGED_DURING_SYNC", transactionId: tx.id });
        }
        return;
      }
      // With no exact donor/payment mapping, keep the source evidence for review.
      // A nearby ledger entry might have a currency conversion or older identity.
      if (!link || !payment.paymentId || candidates.length) { reviews.push({ id: payment.id, reason: candidates.length ? "POSSIBLE_EXISTING_PAYMENT" : "DONOR_OR_PAYMENT_REFERENCE_REQUIRED" }); return; }
      const tx = await db.transaction.create({ data: {
        amount: payment.amount, currency: payment.currency as "INR" | "USD", method: "BMC", type: "DONATION", direction: "IN", status: "APPROVED",
        donationFrequency: payment.frequency, date: new Date(payment.occurredAt), fromUserId: link.userId, createdById: actorId,
        providerPaymentId: payment.paymentId, providerVerified: true, bmcPaymentConfirmed: true, providerState: "CAPTURED",
        bmcEventId: payment.frequency === "ONE_TIME" ? bmcTransactionKeys("donation.created", payment.supportId)[0] : `bmc_history_${bmcAccountSlug()}_${payment.supportId}`,
        description: `BMC ${payment.frequency === "MONTHLY" ? "monthly" : "one-time"} payment recovered from account history`,
        providerDetailsEncrypted: encryptSecret(JSON.stringify({ ...payment, source: "BMC_DASHBOARD_HISTORY" })),
      } });
      const reminder = monthlyReminderUpdate(payment.frequency, new Date(payment.occurredAt));
      if (reminder) await db.user.updateMany({ where: { id: link.userId, OR: [{ donateReminderAnchorAt: null }, { donateReminderAnchorAt: { lt: new Date(payment.occurredAt) } }] }, data: reminder });
      await db.auditLog.create({ data: { userId: actorId, action: "BMC_HISTORY_RECOVERED", entityType: "Transaction", entityId: tx.id, transactionId: tx.id, after: { supportId: payment.supportId, source: payment.evidenceSource } } });
      recovered++;
      matchedIds.add(tx.id);
    });
  }
  return { reviews, confirmed, recovered, matchedIds };
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
  try {
    previous = await readBmcPrivate<BmcSyncHealth>(healthPath());
    const session = await bmcDashboardSession();
    if (!session.generation || !session.connectedBy || session.accountSlug !== bmcAccountSlug() || !session.studioCookie) throw new BmcHistoryError("SESSION_NOT_CONFIGURED", "Import your Helium BMC session in Sentinel to enable automatic verification.", 503);
    const old = await readBmcHistorySnapshot();
    const result = await fetchEntireBmcAccountHistory(session);
    if ((await bmcDashboardSession()).generation !== session.generation) throw new BmcHistoryError("CONNECTION_CHANGED", "The BMC connection changed during sync. Try again.", 409);
    const reconciliation = await reconcileHistory(result.payments, session.connectedBy, session.generation);
    // Compare both ways: subscription updates may have produced legacy ledger
    // rows that never existed in paid history. Flag these without voiding them.
    const ledger = await prisma.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", status: "APPROVED", isTest: false, voidedAt: null,
      OR: [{ bmcEventId: { startsWith: `bmc_support_${bmcAccountSlug()}_` } },
        ...result.subscriptions.map(subscription => ({ bmcEventId: { contains: subscription.stripeId } }))] },
      select: { id: true } });
    const missingLedger = ledger.filter(tx => !reconciliation.matchedIds.has(tx.id) && !reconciliation.reviews.some(review => review.transactionId === tx.id))
      .map(tx => ({ id: `ledger:${tx.id}`, reason: "LEDGER_PAYMENT_NOT_RETURNED", transactionId: tx.id }));
    const disappeared = (old?.payments || []).filter(p => !result.payments.some(row => row.id === p.id));
    const missingSubscriptions = (old?.subscriptions || []).filter(subscription => !result.subscriptions.some(row => row.id === subscription.id));
    const subscriptions = [...result.subscriptions.map(subscription => ({ ...subscription, lastSeenAt: result.fetchedAt, missingFromLatestCheck: false })),
      ...missingSubscriptions.map(subscription => ({ ...subscription, lastSeenAt: subscription.lastSeenAt || old?.fetchedAt, missingFromLatestCheck: true }))];
    const reviews = [...reconciliation.reviews, ...missingLedger, ...disappeared.map(p => ({ id: p.id, reason: "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED" }))];
    await writeBmcPrivate(snapshotPath(), { ...result, subscriptions, accountSlug: session.accountSlug, payments: [...result.payments, ...disappeared], reviews });
    await writeBmcPrivate(healthPath(), { lastAttemptAt: attempt, lastSuccessAt: result.fetchedAt, reviewed: reviews.length, confirmed: reconciliation.confirmed, recovered: reconciliation.recovered });
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
    if (newReviews.length || reconciliation.recovered) await notifyAdmins({ type: "SYSTEM", title: "BMC history verification completed", message: `${result.payments.length} recorded payments checked. ${reconciliation.confirmed} confirmed, ${reconciliation.recovered} recovered, ${newReviews.length} new items need review.`, actionUrl: "/admin/bmc", priority: "HIGH" });
    return { checked: result.payments.length, confirmed: reconciliation.confirmed, recovered: reconciliation.recovered, reviews: reviews.length };
  } catch (error) {
    const known = error instanceof BmcHistoryError ? error : new BmcHistoryError("SYNC_FAILED", "BMC verification could not finish. The previous complete history is retained.", 503);
    await writeBmcPrivate(healthPath(), { lastAttemptAt: attempt, lastSuccessAt: previous?.lastSuccessAt, errorCode: known.code, error: known.message });
    if (known.code !== previous?.errorCode && known.code !== "SESSION_NOT_CONFIGURED") await notifyAdmins({ type: "SYSTEM", title: "BMC verification needs attention", message: known.message, actionUrl: "/admin/bmc", priority: "HIGH" });
    return { error: known.message, code: known.code };
  } finally { clearInterval(heartbeat); await rm(lock, { recursive: true, force: true }); }
}
