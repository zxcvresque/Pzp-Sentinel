import "dotenv/config";
import { prisma } from "../src/lib/db";
import { bmcAccountSlug } from "../src/lib/bmc-attribution";
import { fetchEntireBmcAccountHistory } from "../src/lib/bmc-account-history";
import { BmcHistoryError } from "../src/lib/bmc-history";
import { matchBmcHistoryPayment, readBmcHistorySnapshot } from "../src/lib/bmc-history-sync";
import { evaluateBmcDonorHistory, GATE_ISSUE_TEXT } from "../src/lib/bmc-donor-gate";
import { computeAutoXp } from "../src/lib/auto-xp";

// Read-only proof of what the Sentry bridge gate would publish right now.
//   npx tsx scripts/bmc-gate-dry-run.ts            fetch live BMC history
//   npx tsx scripts/bmc-gate-dry-run.ts --saved    use the last saved complete snapshot
// Runs every query inside a READ ONLY transaction that is rolled back, so it
// cannot change the ledger, publications or webhooks even by mistake.
class DryRunDone extends Error {}
async function main() {
  const saved = process.argv.includes("--saved");
  const history = saved ? await readBmcHistorySnapshot() : await fetchEntireBmcAccountHistory();
  if (!history) throw new Error("No saved complete BMC history snapshot.");
  const unreturned = new Set(("reviews" in history ? history.reviews : []).filter(review => review.reason === "PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED").map(review => review.id));
  const report: unknown[] = [];
  await prisma.$transaction(async db => {
    await db.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const links = await db.bmcSupporterLink.findMany({ where: { accountSlug: bmcAccountSlug() }, select: { supporterId: true, userId: true } });
    const rows = await db.transaction.findMany({ where: { method: "BMC", type: "DONATION", direction: "IN", isTest: false },
      select: { id: true, amount: true, currency: true, status: true, voidedAt: true, providerState: true, fromUserId: true, bmcPaymentConfirmed: true, bmcReviewReason: true,
        donationFrequency: true, bmcHistorySupportId: true, bmcHistoryPaymentId: true, providerPaymentId: true, bmcPaidDate: true, date: true, bmcEventId: true } });
    // Project, in memory only, the stamps the sync's reconciliation step would
    // apply before the gate (same matcher, no writes). Ambiguity stays unstamped.
    const projected = rows.map(row => ({ ...row }));
    const reconciliation: Record<string, number> = {};
    const contested = new Set<string>();
    for (const payment of history.payments) {
      if (payment.refundStatus === "REFUNDED" || !["INR", "USD"].includes(payment.currency)) continue;
      const link = links.find(item => item.supporterId === payment.supporterId);
      const when = Date.parse(payment.occurredAt);
      const candidates = projected.filter(row => (payment.paymentId && (row.providerPaymentId === payment.paymentId || row.bmcHistoryPaymentId === payment.paymentId)) ||
        row.bmcHistorySupportId === payment.supportId || Math.abs(row.date.getTime() - when) <= 36 * 3600_000);
      const result = matchBmcHistoryPayment(payment, candidates.map(row => ({ ...row, amount: row.amount.toString() })), link?.userId || null);
      reconciliation[result.kind === "REVIEW" ? `REVIEW:${result.reason}` : result.kind] = (reconciliation[result.kind === "REVIEW" ? `REVIEW:${result.reason}` : result.kind] || 0) + 1;
      if (result.kind === "REVIEW" && "candidateIds" in result) for (const id of result.candidateIds || []) contested.add(id);
      if (result.kind === "REVIEW" && "transactionId" in result && result.transactionId) contested.add(result.transactionId);
      if (result.kind !== "MATCH") continue;
      Object.assign(projected.find(row => row.id === result.transaction.id)!, { bmcHistorySupportId: payment.supportId, bmcHistoryPaymentId: payment.paymentId,
        bmcPaidDate: payment.occurredAt.slice(0, 10), bmcPaymentConfirmed: true, bmcReviewReason: null, providerState: "CAPTURED", fromUserId: result.transaction.fromUserId || link?.userId || null });
    }
    report.push({ projectedReconciliation: reconciliation });
    const userIds = [...new Set([...links.map(link => link.userId), ...rows.flatMap(row => row.fromUserId ? [row.fromUserId] : [])])];
    const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, telegramId: true } })).map(user => [user.id, user]));
    for (const userId of userIds) {
      const supporterIds = links.filter(link => link.userId === userId).map(link => link.supporterId);
      const result = evaluateBmcDonorHistory({ userId, telegramId: users.get(userId)?.telegramId || null, supporterIds, payments: history.payments,
        subscriptions: history.subscriptions, rows: projected.map(row => ({ ...row, publishedUserId: null })), unreturnedPaymentIds: unreturned });
      const own = history.payments.filter(payment => supporterIds.includes(payment.supporterId));
      report.push({ donor: users.get(userId)?.name || userId, wouldPublish: result.verified,
        bmcCharges: own.length, verifiedTotals: result.totals, bmcTotals: result.expectedTotals,
        issues: result.issues.map(issue => ({ ...issue, text: GATE_ISSUE_TEXT[issue.code] })),
        warnings: result.warnings.map(issue => ({ ...issue, text: GATE_ISSUE_TEXT[issue.code] })),
        // BMC payments only (Razorpay/manual donations are added by the live API).
        autoXpFromBmc: result.verified ? (({ activeUntil, graceUntil, active }) => ({ activeUntil, graceUntil, active }))(computeAutoXp(result.paid.map(({ row, payment }) =>
          ({ id: row.id, paymentDate: payment.occurredAt.slice(0, 10), frequency: payment.frequency, amount: payment.amount, currency: payment.currency })))) : null,
        supporterPaid: own.flatMap(payment => payment.supporterPaid && payment.supporterPaid.currency !== payment.currency ? [`${payment.supporterPaid.amount} ${payment.supporterPaid.currency} -> ${payment.amount} ${payment.currency}`] : []) });
    }
    const unlinked = rows.filter(row => !row.fromUserId && row.status === "APPROVED" && !row.voidedAt).length;
    const unlinkedCharges = history.payments.filter(payment => !links.some(link => link.supporterId === payment.supporterId)).length;
    // What the next check would flag "Not in BMC records" on the ledger itself.
    const historyIds = new Set(history.payments.map(payment => payment.supportId));
    const notInBmc = projected.filter(row => row.status === "APPROVED" && !row.voidedAt && !/REFUND|REVERSE|DISPUTE|FAILED/i.test(row.providerState) &&
      !(row.bmcHistorySupportId && historyIds.has(row.bmcHistorySupportId)) && !contested.has(row.id))
      .map(row => ({ transactionId: row.id, amount: `${row.amount} ${row.currency}`, date: row.date.toISOString().slice(0, 10), donor: row.fromUserId ? users.get(row.fromUserId)?.name || row.fromUserId : null }));
    report.push({ ledgerRowsNotInBmcRecords: notInBmc });
    report.push({ unattributedActiveLedgerRows: unlinked, bmcChargesWithoutDonorLink: unlinkedCharges, historyFetchedAt: history.fetchedAt });
    throw new DryRunDone(); // Always roll back.
  }, { timeout: 60_000 }).catch(error => { if (!(error instanceof DryRunDone)) throw error; });
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error: unknown) => {
  if (error instanceof BmcHistoryError) console.error(JSON.stringify({ ok: false, code: error.code, check: error.detail || null, message: error.message }));
  else console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "Unknown error" }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
