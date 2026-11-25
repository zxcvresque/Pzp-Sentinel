import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { reconcileBmcPayments } from "../../scripts/reconcile-bmc-payments.mjs";

let db: PGlite;
const payments = ["2026-08-29", "2026-09-29", "2026-10-29", "2026-11-25"].map((date, index) => ({
  id: `tx${index}`, date, amount: "25", currency: "USD", bmcEventId: `bmc_monthly_period_${index}`, state: index === 2 ? "UNPAID" : "PAID",
}));
const manifest = { userId: "donor", supporterId: "7701088", reason: "Reviewed paid provider history: August, September, November only", payments };
const client = { query: (sql: string, params?: unknown[]) => db.query(sql, params) };
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TYPE "Role" AS ENUM ('ADMIN', 'DONOR');
    CREATE TABLE "User" (id text PRIMARY KEY, roles "Role"[], status text);
    CREATE TABLE "BmcSupporterLink" ("userId" text, "supporterId" text);
    CREATE TABLE "BmcSubscriptionFeedback" (id text PRIMARY KEY);
    CREATE TABLE "Transaction" (id text PRIMARY KEY, method text, "fromUserId" text, "isTest" boolean DEFAULT false, status text DEFAULT 'APPROVED', direction text DEFAULT 'IN', type text DEFAULT 'DONATION', "donationFrequency" text DEFAULT 'MONTHLY', date timestamp, amount numeric, currency text, "bmcEventId" text, "voidedAt" timestamp, "voidedById" text, "voidReason" text, "providerState" text DEFAULT 'CAPTURED');
    CREATE TABLE "Notification" (id text PRIMARY KEY, "userId" text, "entityId" text, title text, message text);
    CREATE TABLE "AuditLog" (id text PRIMARY KEY, "userId" text, action text, "entityType" text, "entityId" text, "transactionId" text, before jsonb, after jsonb, timestamp timestamp);
    CREATE TABLE "SentryWebhookDelivery" (id text PRIMARY KEY, "transactionId" text, "deliveredAt" timestamp);
    CREATE TABLE "FinanceSyncJob" (id text PRIMARY KEY, action text, "actorName" text, "transactionId" text, "updatedAt" timestamp);
  `);
  const migration = readFileSync("scripts/bmc-payment-confirmation.sql", "utf8");
  await db.exec(migration); await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec(`TRUNCATE "User", "BmcSupporterLink", "Transaction", "Notification", "AuditLog", "SentryWebhookDelivery", "FinanceSyncJob";
    INSERT INTO "User" VALUES ('admin', ARRAY['ADMIN']::"Role"[], 'ACTIVE');
    INSERT INTO "BmcSupporterLink" VALUES ('donor','7701088');
    INSERT INTO "Notification" (id,"userId","entityId",title,message) VALUES ('n','donor','tx2','Monthly donation received','25 received');`);
  for (const row of payments) await db.query('INSERT INTO "Transaction" (id,method,"fromUserId",date,amount,currency,"bmcEventId") VALUES ($1,$2,$3,$4,$5,$6,$7)', [row.id, "BMC", "donor", `${row.date}T10:00:00Z`, row.amount, row.currency, row.bmcEventId]);
});
afterAll(async () => { await db?.close(); });

it("previews the three paid payments and the false October credit without writing", async () => {
  const plan = await reconcileBmcPayments(client, manifest);
  expect(plan.filter(row => row.state === "PAID")).toHaveLength(3);
  expect((await db.query('SELECT * FROM "AuditLog"')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM "Transaction" WHERE "bmcPaymentConfirmed" OR "voidedAt" IS NOT NULL')).rows).toHaveLength(0);
});
it("leaves exactly $75 paid, queues bridge/sheet corrections and is idempotent", async () => {
  await reconcileBmcPayments(client, manifest, true);
  expect((await db.query('SELECT sum(amount)::text AS total, count(*)::int AS count FROM "Transaction" WHERE "bmcPaymentConfirmed" AND "voidedAt" IS NULL')).rows[0]).toEqual({ total: "75", count: 3 });
  expect((await db.query('SELECT "providerState", "voidedAt" FROM "Transaction" WHERE id=$1', ["tx2"])).rows[0]).toMatchObject({ providerState: "PAYMENT_FAILED", voidedAt: expect.any(Date) });
  expect((await db.query('SELECT title FROM "Notification"')).rows[0]).toEqual({ title: "BMC payment correction" });
  expect((await db.query('SELECT * FROM "SentryWebhookDelivery"')).rows).toHaveLength(4);
  await reconcileBmcPayments(client, manifest, true);
  expect((await db.query('SELECT * FROM "AuditLog"')).rows).toHaveLength(4);
  expect((await db.query('SELECT * FROM "FinanceSyncJob"')).rows).toHaveLength(4);
});
it("rolls back the entire correction when any reviewed fact changed", async () => {
  await db.exec(`UPDATE "Transaction" SET amount=30 WHERE id='tx2'`);
  await expect(reconcileBmcPayments(client, manifest, true)).rejects.toThrow("facts changed");
  expect((await db.query('SELECT * FROM "Transaction" WHERE "bmcPaymentConfirmed"')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM "AuditLog"')).rows).toHaveLength(0);
});
