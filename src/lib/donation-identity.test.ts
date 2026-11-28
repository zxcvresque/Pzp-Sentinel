import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { identityMigrationBatch, PIN_DONATION_IDENTITIES_SQL } from "./donation-identity-migration";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE "Transaction" (id text PRIMARY KEY, method text, "bridgeDonationId" text UNIQUE, "providerPaymentId" text UNIQUE, "bmcHistoryPaymentId" text UNIQUE, "bmcHistorySupportId" text UNIQUE)`);
  const sql = readFileSync("scripts/donation-identity.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
}, 30_000);
afterAll(async () => { await db?.close(); });
it("keeps the database identity immutable through reference enrichment and distinct for another charge", async () => {
  await db.exec(`INSERT INTO "Transaction" (id, method, "bridgeDonationId") VALUES ('old', 'BMC', 'bmc:old-published-id')`);
  await db.exec(`UPDATE "Transaction" SET "bmcHistoryPaymentId"='pi_old', "bmcHistorySupportId"='11' WHERE id='old'`);
  expect((await db.query('SELECT "bridgeDonationId" FROM "Transaction" WHERE id=\'old\'')).rows).toEqual([{ bridgeDonationId: "bmc:old-published-id" }]);
  await expect(db.exec(`UPDATE "Transaction" SET "bridgeDonationId"='bmc:pi_old' WHERE id='old'`)).rejects.toThrow("immutable");
  await db.exec(`INSERT INTO "Transaction" (id, method, "providerPaymentId") VALUES ('new', 'BMC', 'pi_new')`);
  expect((await db.query('SELECT "bridgeDonationId" FROM "Transaction" WHERE id=\'new\'')).rows).toEqual([{ bridgeDonationId: "bmc:new" }]);
});
it("rejects a webhook charge already claimed by history and a history charge already claimed by a webhook", async () => {
  await expect(db.exec(`INSERT INTO "Transaction" (id, method, "providerPaymentId") VALUES ('duplicate-webhook', 'BMC', 'pi_old')`)).rejects.toThrow("already belongs");
  await expect(db.exec(`INSERT INTO "Transaction" (id, method, "bmcHistoryPaymentId") VALUES ('duplicate-history', 'BMC', 'pi_new')`)).rejects.toThrow("already belongs");
  expect((await db.query('SELECT id FROM "Transaction" ORDER BY id')).rows).toEqual([{ id: "new" }, { id: "old" }]);
});

it("loads the deployment entry point in its actual Node/tsx format without touching the database", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/pin-donation-identities.ts", "--check"], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@127.0.0.1:9/unused" },
  });
  expect(output).toContain("Donation identity migration entry point loaded successfully.");
});

it("pins a whole batch in one atomic statement and preserves its IDs when replayed", async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(`CREATE TABLE "Transaction" (id text PRIMARY KEY, "bridgeDonationId" text UNIQUE); INSERT INTO "Transaction" (id) VALUES ('legacy-one'), ('legacy-two')`);
    const rows = [
      { id: "legacy-one", method: "BMC", providerPaymentId: "pi_original", bmcEventId: null, orderPaymentId: null },
      { id: "legacy-two", method: "UPI", providerPaymentId: null, bmcEventId: null, orderPaymentId: null },
    ];
    expect((await isolated.query(PIN_DONATION_IDENTITIES_SQL, [JSON.stringify(identityMigrationBatch(rows))])).affectedRows).toBe(2);
    rows[0].providerPaymentId = "pi_added_later";
    expect((await isolated.query(PIN_DONATION_IDENTITIES_SQL, [JSON.stringify(identityMigrationBatch(rows))])).affectedRows).toBe(0);
    expect((await isolated.query('SELECT * FROM "Transaction" ORDER BY id')).rows).toEqual([
      { id: "legacy-one", bridgeDonationId: "bmc:pi_original" }, { id: "legacy-two", bridgeDonationId: "manual:legacy-two" },
    ]);
  } finally { await isolated.close(); }
});
