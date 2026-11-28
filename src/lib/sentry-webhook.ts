import { createHmac, randomUUID } from "node:crypto";
import { bridgePool } from "./donor-bridge";
import { BmcUnverifiedError, donorDonationSummary, getDonation } from "./donor-bridge-donations";

type Delivery = {
  id: string; transactionId: string | null; body: string | null;
  createdAt: Date; attempts: number;
};

export function webhookConfig() {
  const target = process.env.SENTRY_WEBHOOK_URL?.trim();
  if (!target) return null;
  const url = new URL(target);
  // The operator configures the sole destination. No request may supply a URL,
  // and redirects must never forward a signed payment to a different service.
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("SENTRY_WEBHOOK_URL must be an HTTPS URL without credentials or fragment");
  }
  const secret = process.env.SENTRY_WEBHOOK_SECRET?.trim() || process.env.SENTRY_BRIDGE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Configure a webhook secret of at least 32 characters");
  return { url: url.toString(), secret };
}

export function webhookHeaders(body: string, eventId: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Sentinel-Event-Id": eventId,
    "X-Sentinel-Timestamp": timestamp,
    "X-Sentinel-Signature": `sha256=${signature}`,
  };
}

export async function queueWebhookTest(telegramId: string | null) {
  const id = randomUUID();
  const body = JSON.stringify({
    id, schemaVersion: 2, type: "webhook.test", createdAt: new Date().toISOString(),
    transactionId: null, donation: null,
    test: { telegramId, amount: "1", currency: "USD", message: "Delivery test only; no payment occurred and no XP should be awarded." },
  });
  await bridgePool.query('INSERT INTO "SentryWebhookDelivery" (id, body) VALUES ($1, $2)', [id, body]);
  return id;
}

let draining = false;
export async function drainSentryWebhooks(limit = 20) {
  if (draining) return;
  draining = true;
  try {
    const config = webhookConfig();
    if (!config) return;
    for (let index = 0; index < limit; index++) {
      const lease = randomUUID();
      const result = await bridgePool.query<Delivery>(`
        WITH candidate AS (
          SELECT id FROM "SentryWebhookDelivery"
          WHERE "deliveredAt" IS NULL AND "nextAttemptAt" <= now() AND "supersededAt" IS NULL
            AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
          ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE "SentryWebhookDelivery" AS delivery
        SET lease = $1, "lockedUntil" = now() + interval '2 minutes', attempts = attempts + 1
        FROM candidate WHERE delivery.id = candidate.id RETURNING delivery.*`, [lease]);
      const job = result.rows[0];
      if (!job) break;
      // Never deliver BMC facts that did not come from a verified publication.
      const supersede = async (reason: string) => { await bridgePool.query(`UPDATE "SentryWebhookDelivery" SET lease = NULL, "lockedUntil" = NULL,
        "supersededAt" = now(), "lastError" = $1 WHERE id = $2 AND lease = $3`, [reason, job.id, lease]); };
      try {
        let body = job.body;
        const method = job.transactionId ? (await bridgePool.query<{ method: string }>('SELECT method::text AS method FROM "Transaction" WHERE id = $1', [job.transactionId])).rows[0]?.method : undefined;
        if (body && method === "BMC") {
          const frozen = JSON.parse(body) as { donation?: { verification?: string } | null };
          if (frozen.donation?.verification !== "BMC_COMPLETE_HISTORY") { await supersede("Superseded: BMC payload was not a verified publication"); continue; }
        }
        if (!body) {
          let donation = null;
          try { donation = job.transactionId ? await getDonation(job.transactionId) : null; }
          catch (error) { if (error instanceof BmcUnverifiedError) { await supersede("Superseded: BMC payment not yet verified"); continue; } throw error; }
          // Removal of an unpublished BMC row is not a payment correction.
          if (method === "BMC" && !donation) { await supersede("Superseded: BMC payment not published"); continue; }
          body = JSON.stringify({
            id: job.id, schemaVersion: 2, type: donation ? "donation.changed" : "donation.unavailable",
            createdAt: job.createdAt.toISOString(), observedAt: new Date().toISOString(),
            transactionId: job.transactionId, donation,
          });
          // Freeze the first observed payload so every retry has the same ID/body.
          const saved = await bridgePool.query('UPDATE "SentryWebhookDelivery" SET body = $1 WHERE id = $2 AND lease = $3', [body, job.id, lease]);
          if (saved.rowCount !== 1) continue;
        }
        // The donor's current state (totals, BMC verification, auto-XP) is
        // computed at send time, so even a late retry carries current facts.
        // The event ID and the donation record stay as first observed.
        const frozen = JSON.parse(body) as { donation?: { telegramId?: string | null } | null; test?: { telegramId?: string | null } };
        const telegramId = frozen.donation?.telegramId || frozen.test?.telegramId || null;
        const sent = JSON.stringify({ ...frozen, schemaVersion: 2, sentAt: new Date().toISOString(), donor: telegramId ? await donorDonationSummary(telegramId) : null });
        const response = await fetch(config.url, {
          method: "POST", headers: webhookHeaders(sent, job.id, config.secret), body: sent,
          redirect: "manual", signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`Receiver HTTP ${response.status}`);
        await bridgePool.query('UPDATE "SentryWebhookDelivery" SET "deliveredAt" = now(), lease = NULL, "lockedUntil" = NULL, "lastError" = NULL WHERE id = $1 AND lease = $2', [job.id, lease]);
      } catch (error) {
        const seconds = Math.min(3600, 5 * 2 ** Math.min(job.attempts - 1, 10));
        // Never save response bodies, URLs or credentials in diagnostics.
        const message = error instanceof Error && /^Receiver HTTP \d{3}$/.test(error.message) ? error.message : "Delivery or ledger read failed";
        await bridgePool.query(`UPDATE "SentryWebhookDelivery" SET lease = NULL, "lockedUntil" = NULL,
          "nextAttemptAt" = now() + $1 * interval '1 second', "lastError" = $2 WHERE id = $3 AND lease = $4`, [seconds, message, job.id, lease]);
      }
    }
  } catch {
    console.error("[sentry-webhook] Queue unavailable or configuration invalid; check database setup and webhook environment.");
  } finally {
    draining = false;
  }
}

export async function webhookStatus(eventId?: string) {
  const config = webhookConfig();
  if (eventId) {
    const result = await bridgePool.query(`SELECT id, attempts, "createdAt", "nextAttemptAt", "deliveredAt", "lastError"
      FROM "SentryWebhookDelivery" WHERE id = $1`, [eventId]);
    return { configured: !!config, event: result.rows[0] || null };
  }
  const result = await bridgePool.query(`SELECT
    count(*) FILTER (WHERE "deliveredAt" IS NULL AND "supersededAt" IS NULL)::int AS pending,
    count(*) FILTER (WHERE "deliveredAt" IS NULL AND "supersededAt" IS NULL AND "lastError" IS NOT NULL)::int AS retrying,
    count(*) FILTER (WHERE "supersededAt" IS NOT NULL)::int AS superseded,
    max("deliveredAt") AS "lastDeliveredAt" FROM "SentryWebhookDelivery"`);
  return { configured: !!config, ...result.rows[0] };
}
