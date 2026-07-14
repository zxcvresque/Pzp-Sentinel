import "dotenv/config";
import { syncFinanceWorkbook } from "../src/lib/finance-sheets";

async function main() {
  const result = await syncFinanceWorkbook({
    action: "MANUAL_SYNC",
    actorName: "Sentinel CLI",
    sendBackup: false,
  });
  console.log(`Google Sheets synchronized: ${result.transactionCount} transactions`);
}

main().catch((error) => {
  console.error("Google Sheets synchronization failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
