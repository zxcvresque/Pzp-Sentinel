import { createHash, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { donorPaymentIdentity } from "./donor-payment-id";

export const BRIDGE_START = "2026-08-12T18:30:00.000Z";
export const bridgePool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
export type Donation = {
  id: string; provider: string; paymentId: string; telegramId: string | null;
  name: string; amount: string; currency: string; occurredAt: string;
  frequency: "ONE_TIME" | "MONTHLY"; state: "PAID" | "REVERSED";
  historical?: boolean; transactionId?: string; reversalReason?: string;
};

export function bridgeAuthorized(request: Request): boolean {
  const secret = process.env.SENTRY_BRIDGE_SECRET?.trim() || "";
  const provided = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] || "";
  if (secret.length < 32) return false;
  const a = Buffer.from(secret), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function bridgeState(key: string, value: unknown) {
  await bridgePool.query("INSERT INTO donor_bridge_state VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]);
}

export async function storeProviderDonation(d: Donation) {
  if (!Number.isFinite(new Date(d.occurredAt).getTime()) || !/(Z|[+-]\d{2}:\d{2})$/.test(d.occurredAt)) throw new Error("Invalid payment timestamp");
  if (new Date(d.occurredAt) < new Date(BRIDGE_START) || !Number.isFinite(Number(d.amount)) || Number(d.amount) <= 0) return;
  if (!["INR", "USD"].includes(d.currency)) throw new Error("Unsupported bridge currency");
  await bridgePool.query("INSERT INTO donor_bridge_sources(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=now()", [d.id, JSON.stringify(d)]);
}

// Snapshot all eligible ledger rows on each sweep. This also catches manual
// voids/identity repairs without requiring every existing write path to change.
export async function refreshBridgeEvents() {
  const client = await bridgePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(729045821)");
    const sources = await client.query("SELECT payload FROM donor_bridge_sources ORDER BY id");
    const donations = new Map<string, Donation>(sources.rows.map(r => [r.payload.id, r.payload]));
    const rows = await client.query(`SELECT t.*, u."telegramId", u.name,
      o."paymentId" AS order_payment, i."telegramId" AS guest_tg, i."guestName" AS guest_name
      FROM "Transaction" t LEFT JOIN "User" u ON u.id=t."fromUserId"
      LEFT JOIN "RazorpayOrder" o ON o."transactionId"=t.id
      LEFT JOIN "OneTimeDonationInvite" i ON i.id=o."inviteId"
      WHERE (t.date >= $1 AND t.direction='IN' AND t.type='DONATION'
      AND t."isTest"=false AND t.status='APPROVED'
      AND (t."providerVerified"=true OR t."reviewedById" IS NOT NULL))
      OR t.id IN (SELECT DISTINCT payload->>'transactionId' FROM donor_bridge_events WHERE payload->>'transactionId' IS NOT NULL)
      ORDER BY t.date,t.id`, [BRIDGE_START]);
    for (const row of rows.rows) {
      const { id, provider, paymentId } = donorPaymentIdentity(row.method, row.providerPaymentId || row.order_payment || row.bmcEventId, row.id);
      const source = donations.get(id);
      donations.set(id, {
        id, provider, paymentId, transactionId: row.id,
        telegramId: row.telegramId || row.guest_tg || source?.telegramId || null,
        name: row.name || row.guest_name || source?.name || "Unmatched donor",
        amount: String(row.amount), currency: row.currency, occurredAt: new Date(row.date).toISOString(),
        frequency: row.donationFrequency,
        state: row.voidedAt || row.isTest || (row.status && row.status !== "APPROVED") || (row.direction && row.direction !== "IN") || (row.type && row.type !== "DONATION") || /REFUND|REVERSE|DISPUTE/i.test(row.providerState) || source?.state === "REVERSED" ? "REVERSED" : "PAID",
        reversalReason: row.voidReason || source?.reversalReason || undefined,
      });
    }
    const latest = await client.query("SELECT DISTINCT ON (donation_id) donation_id,digest,payload FROM donor_bridge_events ORDER BY donation_id,seq DESC");
    const digests = new Map(latest.rows.map(r => [r.donation_id, r.digest]));
    const previous = new Map<string, Donation>(latest.rows.map(r => [r.donation_id, r.payload]));
    for (const d of donations.values()) {
      if (new Date(d.occurredAt) < new Date(BRIDGE_START)) {
        const prior=previous.get(d.id);
        if (!prior) continue;
        // A finance edit moved a previously eligible payment before the cutoff.
        // Emit a reversal using its original timestamp, not an invalid feed item.
        d.occurredAt=prior.occurredAt; d.state="REVERSED";
        d.reversalReason="Payment date was moved before the bridge cutoff";
      }
      const payload = JSON.stringify(d);
      const digest = createHash("sha256").update(payload).digest("hex");
      if (digests.get(d.id) !== digest) {
        await client.query("INSERT INTO donor_bridge_events(donation_id,digest,payload) VALUES($1,$2,$3)", [d.id, digest, payload]);
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
