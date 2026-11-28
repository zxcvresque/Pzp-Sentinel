// node --env-file=.env scripts/reconcile-bmc-payments.mjs manifest.json [--apply]
// Review an exact manifest first. This never invents charges from billing periods.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

export function validateManifest(manifest) {
  if (!manifest?.userId || !manifest.supporterId || !manifest.reason?.trim() || !Array.isArray(manifest.payments) || !manifest.payments.length) throw new Error("Manifest requires userId, supporterId, reason and payments");
  const ids = new Set();
  for (const item of manifest.payments) {
    if (!item.id || ids.has(item.id) || !["PAID", "UNPAID"].includes(item.state) || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !["INR", "USD"].includes(item.currency) || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0 || !item.bmcEventId) throw new Error("Invalid or duplicate manifest payment");
    ids.add(item.id);
  }
}

export async function reconcileBmcPayments(client, manifest, apply = false) {
  validateManifest(manifest);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    const link = await client.query('SELECT "userId" FROM "BmcSupporterLink" WHERE "supporterId"=$1', [manifest.supporterId]);
    if (!link.rows.length || link.rows.some(row => row.userId !== manifest.userId)) throw new Error("Supporter attribution does not match manifest");
    const actor = await client.query(`SELECT id FROM "User" WHERE roles @> ARRAY['ADMIN']::"Role"[] AND status='ACTIVE' ORDER BY id LIMIT 1`);
    if (!actor.rows[0]) throw new Error("No active admin for the correction audit");
    const plan = [];
    for (const item of manifest.payments) {
      const result = await client.query('SELECT * FROM "Transaction" WHERE id=$1 FOR UPDATE', [item.id]);
      const row = result.rows[0];
      const day = row?.date && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.date));
      if (!row || row.method !== "BMC" || row.fromUserId !== manifest.userId || row.isTest || row.status !== "APPROVED" || row.direction !== "IN" || row.type !== "DONATION" || row.donationFrequency !== "MONTHLY" || day !== item.date || row.currency !== item.currency || Number(row.amount) !== Number(item.amount) || row.bmcEventId !== item.bmcEventId) throw new Error(`Ledger facts changed for ${item.id}; review again`);
      if (item.state === "PAID" && (row.voidedAt || /REFUND|REVERSE|DISPUTE|FAILED/.test(row.providerState))) throw new Error(`Refusing to restore reversed payment ${item.id}`);
      const changed = item.state === "PAID" ? !row.bmcPaymentConfirmed : !row.voidedAt;
      plan.push({ id: item.id, date: item.date, amount: item.amount, currency: item.currency, state: item.state, changed });
      if (!apply || !changed) continue;
      const updated = item.state === "PAID"
        ? await client.query('UPDATE "Transaction" SET "bmcPaymentConfirmed"=true WHERE id=$1 RETURNING *', [item.id])
        : await client.query('UPDATE "Transaction" SET "bmcPaymentConfirmed"=false,"providerState"=$2,"voidedAt"=now(),"voidedById"=$3,"voidReason"=$4 WHERE id=$1 RETURNING *', [item.id, "PAYMENT_FAILED", actor.rows[0].id, manifest.reason]);
      const facts = payment => ({ id: payment.id, amount: payment.amount, currency: payment.currency, date: payment.date, providerState: payment.providerState, bmcPaymentConfirmed: payment.bmcPaymentConfirmed, voidedAt: payment.voidedAt, voidReason: payment.voidReason });
      await client.query('INSERT INTO "AuditLog" (id,"userId",action,"entityType","entityId","transactionId",before,after,"timestamp") VALUES ($1,$2,$3,$4,$5,$5,$6,$7,now())', [randomUUID(), actor.rows[0].id, "BMC_PAYMENT_RECONCILED", "Transaction", item.id, JSON.stringify(facts(row)), JSON.stringify({ ...facts(updated.rows[0]), evidence: manifest.reason })]);
      await client.query('INSERT INTO "FinanceSyncJob" (id,action,"actorName","transactionId","updatedAt") VALUES ($1,$2,$3,$4,now())', [randomUUID(), "UPDATED", "BMC payment reconciliation", item.id]);
      if (item.state === "UNPAID") {
        // Historical notifications must no longer claim that this charge passed.
        await client.query('UPDATE "Notification" SET title=$2,message=$3,"actionUrl"=$4 WHERE "entityId"=$1 AND "userId"=$5', [item.id, "BMC payment correction", `The ${item.date} ${item.currency} ${item.amount} entry was not a successful payment and has been removed from your donation totals. ${manifest.reason}`, "/donor", manifest.userId]);
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return plan;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Supply a reviewed manifest.json (dry run by default; --apply writes)");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try { console.log(JSON.stringify({ applied: process.argv.includes("--apply"), payments: await reconcileBmcPayments(client, manifest, process.argv.includes("--apply")) }, null, 2)); }
  finally { client.release(); await pool.end(); }
}
