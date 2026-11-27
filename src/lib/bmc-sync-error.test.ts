import { expect, it } from "vitest";
import { BmcHistoryError } from "./bmc-history";
import { bmcSyncFailure } from "./bmc-sync-error";
it("preserves specific provider/session errors", () => {
  const error = new BmcHistoryError("SESSION_EXPIRED", "Import a fresh session.", 503);
  expect(bmcSyncFailure(error, "FETCH_HISTORY")).toMatchObject({ error, stage: "FETCH_HISTORY" });
});
it.each(["P2010", "P2028", "ECONNREFUSED"])("classifies database error %s with a safe diagnostic code", code => {
  const failure = bmcSyncFailure(Object.assign(Error("cookie=private; connection-string=private"), { code }), "RECONCILE_LEDGER");
  expect(failure.error.code).toBe("SYNC_DATABASE_FAILED");
  expect(failure.diagnosticCode).toBe(code);
  expect(failure.error.message).toContain("ledger verification");
  expect(failure.error.message).not.toContain("private");
});
it.each(["LOAD_SESSION", "FETCH_HISTORY", "RECONCILE_LEDGER", "SAVE_HISTORY", "NOTIFY_ADMINS"] as const)("identifies stage %s without copying arbitrary messages or codes", stage => {
  const failure = bmcSyncFailure({ code: "secret-cookie", message: "private session value" }, stage);
  expect(failure.stage).toBe(stage);
  expect(failure).not.toHaveProperty("diagnosticCode");
  expect(failure.error.message).not.toMatch(/secret-cookie|private session value/);
});
