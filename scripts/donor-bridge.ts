import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bridgePool } from "../src/lib/donor-bridge";

// Installs donor_bridge_bmc_intents (guest BMC attribution), the only bridge
// table the app still uses. The Sentry bridge is only
// GET /api/sentry-bridge/donations; the legacy /events feed, its sync/watch
// worker, the outbound webhook and the /entry donate-link route were removed.
async function main() {
  if (!process.argv.includes("--setup")) {
    console.log("Usage: npm run bridge:setup. The legacy bridge sync/watch worker was removed.");
    return;
  }
  await bridgePool.query(await readFile(resolve(process.cwd(), "scripts/donor-bridge-schema.sql"), "utf8"));
  console.log("Additive donor bridge schema installed.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Bridge setup failed"); process.exitCode = 1; }).finally(() => bridgePool.end());
