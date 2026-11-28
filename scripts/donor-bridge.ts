import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bridgePool } from "../src/lib/donor-bridge";

// Installs the additive bridge tables still used by the app: donor_bridge_entries
// (POST /api/sentry-bridge/entry donate links) and donor_bridge_bmc_intents
// (guest BMC attribution). The legacy /events feed and its sync/watch worker
// were removed: Sentry reads /api/sentry-bridge/donations and the signed webhook.
async function main() {
  if (!process.argv.includes("--setup")) {
    console.log("Usage: npm run bridge:setup. The legacy bridge sync/watch worker was removed.");
    return;
  }
  await bridgePool.query(await readFile(resolve(process.cwd(), "scripts/donor-bridge-schema.sql"), "utf8"));
  console.log("Additive donor bridge schema installed.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Bridge setup failed"); process.exitCode = 1; }).finally(() => bridgePool.end());
