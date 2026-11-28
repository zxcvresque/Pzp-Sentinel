import "dotenv/config";
import { databasePool } from "../src/lib/database-pool";
import { identityMigrationBatch, PIN_DONATION_IDENTITIES_SQL, type IdentityMigrationRow } from "../src/lib/donation-identity-migration";

// Run after db push, before restarting. Preserve currently published IDs; never
// rename old donations to the new transaction-based format during an upgrade.
async function main() {
  try {
    if (process.argv.includes("--check")) {
      console.log("Donation identity migration entry point loaded successfully.");
      return;
    }
    let pinned = 0;
    for (;;) {
      const { rows } = await databasePool.query<IdentityMigrationRow>(`
        SELECT tx.id, tx.method, tx."providerPaymentId", tx."bmcEventId", ord."paymentId" AS "orderPaymentId"
        FROM "Transaction" tx LEFT JOIN "RazorpayOrder" ord ON ord."transactionId" = tx.id
        WHERE tx."bridgeDonationId" IS NULL ORDER BY tx.id LIMIT 200
      `);
      if (!rows.length) break;
      const result = await databasePool.query(PIN_DONATION_IDENTITIES_SQL, [JSON.stringify(identityMigrationBatch(rows))]);
      pinned += result.rowCount || 0;
    }
    console.log(`Preserved ${pinned} existing donation identities.`);
  } finally { await databasePool.end(); }
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^(P\d{4}|\d{5}|E[A-Z_]{2,40})$/.test(error.code) ? ` (${error.code})` : "";
  console.error(`Donation identity preservation failed${code}. Keep Sentinel stopped and resolve the migration before restarting.`);
  process.exitCode = 1;
});
