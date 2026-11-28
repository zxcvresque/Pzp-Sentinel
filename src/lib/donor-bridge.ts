import { timingSafeEqual } from "node:crypto";
import { databasePool as bridgePool } from "./database-pool";

// Sentry reads one API (/api/sentry-bridge/donations) and receives one signed
// webhook (sentry-webhook.ts). The legacy /events feed and its
// donor_bridge_sources/donor_bridge_events tables are no longer read or written.
export { bridgePool };
export type Donation = {
  id: string; provider: string; paymentId: string; telegramId: string | null;
  name: string; amount: string; currency: string; occurredAt: string;
  frequency: "ONE_TIME" | "MONTHLY"; state: "PAID" | "REVERSED";
};

export function bridgeAuthorized(request: Request): boolean {
  const secret = process.env.SENTRY_BRIDGE_SECRET?.trim() || "";
  const provided = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] || "";
  if (secret.length < 32) return false;
  const a = Buffer.from(secret), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
