import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), getDonation: vi.fn() }));
vi.mock("./donor-bridge", () => ({ bridgePool: { query: mocks.query } }));
vi.mock("./donor-bridge-donations", () => ({ getDonation: mocks.getDonation }));
import { drainSentryWebhooks } from "./sentry-webhook";

let db: PGlite;
const triggers = readFileSync("scripts/sentry-webhook-triggers.sql", "utf8");
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "Transaction" (
      id text PRIMARY KEY, type text DEFAULT 'DONATION', direction text DEFAULT 'IN',
      status text DEFAULT 'APPROVED', "isTest" boolean DEFAULT false, amount numeric DEFAULT 1,
      currency text DEFAULT 'USD', method text DEFAULT 'OTHER', "fromUserId" text,
      "voidedAt" timestamp, "voidReason" text, "providerState" text DEFAULT 'MANUAL',
      "donationAnnouncedAt" timestamp, "providerPaymentId" text, "bmcEventId" text,
      date timestamp DEFAULT now(), "donationFrequency" text DEFAULT 'ONE_TIME'
    );
    CREATE TABLE "User" (id text PRIMARY KEY, "telegramId" text, name text);
    CREATE TABLE "OneTimeDonationInvite" (id text PRIMARY KEY, "telegramId" text, "guestName" text);
    CREATE TABLE "RazorpayOrder" (id text PRIMARY KEY, "transactionId" text, "paymentId" text, "inviteId" text);
    CREATE TABLE "SentryWebhookDelivery" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "transactionId" text,
      body text, "createdAt" timestamp DEFAULT now(), "nextAttemptAt" timestamp DEFAULT now(),
      attempts integer DEFAULT 0, lease uuid, "lockedUntil" timestamp, "deliveredAt" timestamp, "lastError" text
    );
  `);
  await db.exec(triggers);
  await db.exec(triggers); // Upgrades must be safely repeatable.
}, 30_000);
beforeEach(async () => { await db.exec('TRUNCATE "SentryWebhookDelivery", "Transaction", "User", "RazorpayOrder", "OneTimeDonationInvite"'); });
afterAll(async () => { await db?.close(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function events() { return (await db.query<{ transactionId: string }>('SELECT "transactionId" FROM "SentryWebhookDelivery"')).rows; }

it.each(["OTHER", "RAZORPAY", "BMC"])("queues an approved %s donation atomically", async method => {
  await db.query('INSERT INTO "Transaction" (id, method) VALUES ($1, $2)', ["tx1", method]);
  expect(await events()).toEqual([{ transactionId: "tx1" }]);
  await db.exec('BEGIN; INSERT INTO "Transaction" (id) VALUES (\'rolled_back\'); ROLLBACK;');
  expect(await events()).toHaveLength(1);
});
it("excludes test, pending, outgoing, zero and non-donation rows; approval enqueues", async () => {
  await db.exec(`
    INSERT INTO "Transaction" (id, "isTest") VALUES ('test', true);
    INSERT INTO "Transaction" (id, status) VALUES ('pending', 'PENDING');
    INSERT INTO "Transaction" (id, direction) VALUES ('out', 'OUT');
    INSERT INTO "Transaction" (id, amount) VALUES ('zero', 0);
    INSERT INTO "Transaction" (id, type) VALUES ('expense', 'EXPENSE');
  `);
  expect(await events()).toHaveLength(0);
  await db.exec(`UPDATE "Transaction" SET status = 'APPROVED' WHERE id = 'pending'`);
  expect(await events()).toEqual([{ transactionId: "pending" }]);
});
it("queues edits, refunds, voids, loss of eligibility and deletes, but ignores housekeeping", async () => {
  await db.exec(`INSERT INTO "Transaction" (id) VALUES ('tx1')`);
  await db.exec(`UPDATE "Transaction" SET "donationAnnouncedAt" = now() WHERE id = 'tx1'`);
  expect(await events()).toHaveLength(1);
  await db.exec(`UPDATE "Transaction" SET amount = 2 WHERE id = 'tx1'`);
  await db.exec(`UPDATE "Transaction" SET "providerState" = 'REFUNDED' WHERE id = 'tx1'`);
  await db.exec(`UPDATE "Transaction" SET "voidedAt" = now(), "voidReason" = 'test complete' WHERE id = 'tx1'`);
  await db.exec(`UPDATE "Transaction" SET "isTest" = true WHERE id = 'tx1'`);
  expect(await events()).toHaveLength(5);
  await db.exec(`INSERT INTO "Transaction" (id) VALUES ('deleted'); DELETE FROM "Transaction" WHERE id = 'deleted'`);
  expect((await events()).filter(row => row.transactionId === "deleted")).toHaveLength(2);
});
it("queues donor and guest identity corrections and order linkage", async () => {
  await db.exec(`
    INSERT INTO "User" VALUES ('u1', '5988446905', 'Feynman');
    INSERT INTO "Transaction" (id, "fromUserId") VALUES ('named', 'u1');
    INSERT INTO "Transaction" (id) VALUES ('guest');
    INSERT INTO "OneTimeDonationInvite" VALUES ('invite', '5988446905', 'Guest');
    INSERT INTO "RazorpayOrder" VALUES ('order', 'guest', 'pay1', 'invite');
  `);
  expect(await events()).toHaveLength(3);
  await db.exec(`UPDATE "User" SET "telegramId" = '604642404' WHERE id = 'u1'`);
  await db.exec(`UPDATE "OneTimeDonationInvite" SET "guestName" = 'Corrected guest' WHERE id = 'invite'`);
  await db.exec(`UPDATE "RazorpayOrder" SET "paymentId" = 'pay2' WHERE id = 'order'`);
  expect(await events()).toHaveLength(6);
});

function useRealQueue() {
  mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows };
  });
  mocks.getDonation.mockResolvedValue({ transactionId: "tx1", state: "PAID" });
  vi.stubEnv("SENTRY_WEBHOOK_URL", "https://receiver.example.test/sentinel");
  vi.stubEnv("SENTRY_WEBHOOK_SECRET", "x".repeat(64));
}

it("claims a real queued row, freezes its payload and acknowledges delivery", async () => {
  useRealQueue();
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await db.exec(`INSERT INTO "Transaction" (id) VALUES ('tx1')`);
  await drainSentryWebhooks(1);
  const { rows } = await db.query<{ deliveredAt: Date; attempts: number; body: string; lease: string | null }>('SELECT * FROM "SentryWebhookDelivery"');
  expect(rows[0].deliveredAt).not.toBeNull();
  expect(rows[0].attempts).toBe(1);
  expect(rows[0].lease).toBeNull();
  expect(rows[0].body).toBe(fetcher.mock.calls[0][1].body);
});

it("retries a failed real delivery and recovers expired worker leases", async () => {
  useRealQueue();
  const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
  vi.stubGlobal("fetch", fetcher);
  await db.exec(`INSERT INTO "Transaction" (id) VALUES ('tx1')`);
  await drainSentryWebhooks(1);
  let result = await db.query<{ body: string; deliveredAt: Date | null; attempts: number; lastError: string }>('SELECT * FROM "SentryWebhookDelivery"');
  const body = result.rows[0].body;
  expect(result.rows[0]).toMatchObject({ deliveredAt: null, attempts: 1, lastError: "Delivery or ledger read failed" });
  await db.exec(`UPDATE "SentryWebhookDelivery" SET "nextAttemptAt" = now() - interval '1 second', lease = gen_random_uuid(), "lockedUntil" = now() - interval '1 second'`);
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));
  await drainSentryWebhooks(1);
  result = await db.query('SELECT * FROM "SentryWebhookDelivery"');
  expect(result.rows[0].deliveredAt).not.toBeNull();
  expect(result.rows[0].attempts).toBe(2);
  expect(fetcher.mock.calls[1][1].body).toBe(body);
});
