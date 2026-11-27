import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
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
