import "dotenv/config";
import { execFileSync } from "node:child_process";
import { importBmcSession } from "../src/lib/bmc-session-import";
import { BmcHistoryError } from "../src/lib/bmc-history";

// Local-only: imports the Helium extractor's session value from the macOS
// clipboard into the encrypted local session file (data/bmc-dashboard).
// The value is never printed, logged or passed on the command line.
async function main() {
  const token = execFileSync("pbpaste", { encoding: "utf8", maxBuffer: 1 << 20 }).trim();
  if (!token.startsWith("{")) throw new BmcHistoryError("INVALID_SESSION_TOKEN", "Clipboard does not contain the Helium extractor session value.", 400);
  const result = await importBmcSession("local-cli", undefined, undefined, fetch, token);
  console.log(JSON.stringify({ ok: true, accountSlug: result.accountSlug, connectedAt: result.connectedAt }));
}

main().catch((error: unknown) => {
  if (error instanceof BmcHistoryError) console.error(JSON.stringify({ ok: false, code: error.code, check: error.detail || null, message: error.message }));
  else console.error(JSON.stringify({ ok: false, code: "UNEXPECTED", message: error instanceof Error ? error.name : "Unknown error" }));
  process.exitCode = 1;
});
