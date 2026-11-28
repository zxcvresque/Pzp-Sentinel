import { BmcHistoryError } from "./bmc-history";

export type BmcSyncStage = "LOAD_SESSION" | "FETCH_HISTORY" | "RECONCILE_LEDGER" | "SAVE_HISTORY" | "PUBLISH_BRIDGE" | "NOTIFY_ADMINS";

/** Public diagnostics are classifications only; Prisma/provider messages may contain secrets. */
export function bmcSyncFailure(error: unknown, stage: BmcSyncStage) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^(P\d{4}|E[A-Z_]{2,40})$/.test(error.code) ? error.code : undefined;
  if (error instanceof BmcHistoryError) return { error, stage, ...(code ? { diagnosticCode: code } : {}) };
  const database = code?.startsWith("P") || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(code || "");
  const detail = code ? ` (${code})` : "";
  const messages: Record<BmcSyncStage, string> = {
    LOAD_SESSION: "The saved BMC session or history could not be read. Check server file permissions and the encryption key.",
    FETCH_HISTORY: "BMC history could not be downloaded. Retry the check; existing history is retained.",
    RECONCILE_LEDGER: `BMC history was downloaded, but ledger verification could not finish${detail}. Retry after checking the Sentinel database connection and deployed version.`,
    SAVE_HISTORY: "BMC verification reached the history-save step, but the server could not save its result. Check server disk space and file permissions.",
    PUBLISH_BRIDGE: `BMC history was saved, but donor verification could not finish${detail}. Every donor's previously published Sentry data is unchanged.`,
    NOTIFY_ADMINS: "BMC history was saved, but its admin notification could not be delivered.",
  };
  return { error: new BmcHistoryError(database ? "SYNC_DATABASE_FAILED" : "SYNC_FAILED", messages[stage], 503), stage, ...(code ? { diagnosticCode: code } : {}) };
}
