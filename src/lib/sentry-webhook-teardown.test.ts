import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, it } from "vitest";

// The outbound Sentry webhook was removed. Production databases still carry its
// queueing triggers; the teardown must remove them before the queue table so a
// ledger write can never reference a dropped relation.
const teardown = readFileSync("scripts/sentry-webhook-teardown.sql", "utf8");
const functions = ["sentinel_queue_donation_webhook", "sentinel_queue_donor_identity_webhook", "sentinel_queue_order_webhook", "sentinel_queue_bmc_publication_webhook"];

// Minimal shape of the retired scripts/sentry-webhook-triggers.sql install.
const legacyInstall = `
  CREATE TABLE "Transaction" (id text PRIMARY KEY, method text, amount numeric, "fromUserId" text);
  CREATE TABLE "User" (id text PRIMARY KEY, "telegramId" text, name text);
  CREATE TABLE "OneTimeDonationInvite" (id text PRIMARY KEY, "telegramId" text, "guestName" text);
  CREATE TABLE "RazorpayOrder" (id text PRIMARY KEY, "transactionId" text, "inviteId" text);
  CREATE TABLE "BmcBridgePublication" ("transactionId" text PRIMARY KEY, fingerprint text);
  CREATE TABLE "SentryWebhookDelivery" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "transactionId" text);
  CREATE FUNCTION sentinel_queue_donation_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO "SentryWebhookDelivery" ("transactionId") VALUES (COALESCE(NEW.id, OLD.id)); RETURN NULL; END $$;
  CREATE TRIGGER sentinel_donation_webhook AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
    FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donation_webhook();
  CREATE FUNCTION sentinel_queue_donor_identity_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO "SentryWebhookDelivery" ("transactionId") SELECT id FROM "Transaction" WHERE "fromUserId" = NEW.id; RETURN NULL; END $$;
  CREATE TRIGGER sentinel_donor_identity_webhook AFTER UPDATE OF "telegramId", name ON "User"
    FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donor_identity_webhook();
  CREATE TRIGGER sentinel_guest_identity_webhook AFTER UPDATE OF "telegramId", "guestName" ON "OneTimeDonationInvite"
    FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donor_identity_webhook();
  CREATE FUNCTION sentinel_queue_order_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO "SentryWebhookDelivery" ("transactionId") VALUES (COALESCE(NEW."transactionId", OLD."transactionId")); RETURN NULL; END $$;
  CREATE TRIGGER sentinel_order_webhook AFTER INSERT OR UPDATE OR DELETE ON "RazorpayOrder"
    FOR EACH ROW EXECUTE FUNCTION sentinel_queue_order_webhook();
  CREATE FUNCTION sentinel_queue_bmc_publication_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO "SentryWebhookDelivery" ("transactionId") VALUES (NEW."transactionId"); RETURN NULL; END $$;
  CREATE TRIGGER sentinel_bmc_publication_webhook AFTER INSERT OR UPDATE ON "BmcBridgePublication"
    FOR EACH ROW EXECUTE FUNCTION sentinel_queue_bmc_publication_webhook();
`;

const open: PGlite[] = [];
async function database(sql = "") {
  const db = new PGlite();
  open.push(db);
  if (sql) await db.exec(sql);
  return db;
}
afterEach(async () => { await Promise.all(open.splice(0).map(db => db.close())); });

const userTriggers = async (db: PGlite) => (await db.query<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname")).rows.map(row => row.tgname);
const queueFunctions = async (db: PGlite) => (await db.query<{ proname: string }>("SELECT proname FROM pg_proc WHERE proname = ANY($1) ORDER BY proname", [functions])).rows.map(row => row.proname);
const queueTable = async (db: PGlite) => (await db.query<{ queue: string | null }>(`SELECT to_regclass('"SentryWebhookDelivery"')::text AS queue`)).rows[0].queue;

it("removes every webhook trigger, function and the queue from a legacy install", async () => {
  const db = await database(legacyInstall);
  // Precondition: the legacy install really queues on ledger writes.
  await db.exec(`INSERT INTO "Transaction" VALUES ('tx1', 'RAZORPAY', 5, 'user1')`);
  expect((await db.query(`SELECT 1 FROM "SentryWebhookDelivery"`)).rows).toHaveLength(1);
  expect(await userTriggers(db)).toHaveLength(5);
  expect(await queueFunctions(db)).toEqual([...functions].sort());

  await db.exec(teardown);

  expect(await userTriggers(db)).toEqual([]);
  expect(await queueFunctions(db)).toEqual([]);
  expect(await queueTable(db)).toBeNull();
});

it("leaves ledger and identity writes working after the queue is gone", async () => {
  const db = await database(legacyInstall);
  await db.exec(teardown);
  await db.exec(`
    INSERT INTO "User" VALUES ('user1', '100000001', 'Donor');
    INSERT INTO "Transaction" VALUES ('tx1', 'RAZORPAY', 5, 'user1');
    UPDATE "Transaction" SET amount = 6 WHERE id = 'tx1';
    UPDATE "User" SET name = 'Renamed donor', "telegramId" = '100000002' WHERE id = 'user1';
    UPDATE "OneTimeDonationInvite" SET "guestName" = 'Guest' WHERE id = 'none';
    INSERT INTO "RazorpayOrder" VALUES ('order1', 'tx1', NULL);
    INSERT INTO "BmcBridgePublication" VALUES ('tx1', 'f1');
  `);
  expect((await db.query<{ amount: string }>(`SELECT amount::text FROM "Transaction" WHERE id = 'tx1'`)).rows[0].amount).toBe("6");
  expect((await db.query<{ name: string }>(`SELECT name FROM "User" WHERE id = 'user1'`)).rows[0].name).toBe("Renamed donor");
});

it("is safe to run again, and on a database that never had the webhook", async () => {
  const legacy = await database(legacyInstall);
  await legacy.exec(teardown);
  await expect(legacy.exec(teardown)).resolves.toBeDefined();
  expect(await queueTable(legacy)).toBeNull();

  // Fresh database: no queue, no trigger functions, no "BmcBridgePublication".
  const fresh = await database();
  await expect(fresh.exec(teardown)).resolves.toBeDefined();
  expect(await queueTable(fresh)).toBeNull();
  expect(await queueFunctions(fresh)).toEqual([]);
});
