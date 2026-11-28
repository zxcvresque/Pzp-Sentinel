import "dotenv/config";
import { fetchEntireBmcAccountHistory } from "../src/lib/bmc-account-history";
import { BmcHistoryError, bmcDashboardSession } from "../src/lib/bmc-history";

// Read-only: downloads the complete BMC history with the stored encrypted
// session and prints only counts or the exact failed check. It never writes
// the ledger, the snapshot, or any payer details.
async function main() {
  const session = await bmcDashboardSession();
  const started = Date.now();
  const result = await fetchEntireBmcAccountHistory(session);
  const byKind = (kind: string) => result.payments.filter(row => row.frequency === kind);
  console.log(JSON.stringify({
    ok: true, seconds: Math.round((Date.now() - started) / 1000),
    subscriptions: result.subscriptions.length,
    subscriptionStatus: Object.fromEntries(["ACTIVE", "PAUSED", "CANCELLING", "CANCELLED"].map(status => [status, result.subscriptions.filter(row => row.status === status).length])),
    monthlyCharges: byKind("MONTHLY").length, oneTimeCharges: byKind("ONE_TIME").length,
    refunded: result.payments.filter(row => row.refundStatus === "REFUNDED").length,
    withoutPaymentReference: result.payments.filter(row => !row.paymentId).length,
    currencies: [...new Set(result.payments.map(row => row.currency))],
  }, null, 2));
}

main().catch((error: unknown) => {
  if (error instanceof BmcHistoryError) console.error(JSON.stringify({ ok: false, code: error.code, check: error.detail || null, message: error.message }, null, 2));
  else console.error(JSON.stringify({ ok: false, code: "UNEXPECTED", message: error instanceof Error ? error.name : "Unknown error" }));
  process.exitCode = 1;
});
