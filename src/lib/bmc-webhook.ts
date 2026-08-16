import { createHash, createHmac, timingSafeEqual } from "crypto";
import { bmcAccountSlug } from "./bmc-attribution";

export type BmcCurrency = "INR" | "USD";

export interface BmcEnvelope {
  providerEventId: string | null;
  type: string;
  liveMode: boolean;
  attempt: number;
  createdAt: Date;
  data: Record<string, unknown>;
}

export interface NormalizedBmcEvent extends BmcEnvelope {
  resourceId: string;
  supporterName: string;
  supporterId: string | null;
  supporterEmail: string | null;
  amount: number;
  currency: BmcCurrency;
  note: string | null;
  itemLabel: string | null;
  occurredAt: Date;
  eventKey: string;
}

const EVENT_ALIASES: Record<string, string> = {
  "payment.created": "donation.created",
  "support.created": "donation.created",
  "payment.refunded": "donation.refunded",
  "support.refunded": "donation.refunded",
  "extras.purchased": "extra_purchase.created",
  "extras.refunded": "extra_purchase.refunded",
  "extras.updated": "extra_purchase.updated",
  "monthly_support.started": "recurring_donation.started",
  "monthly_support.updated": "recurring_donation.updated",
  "monthly_support.cancelled": "recurring_donation.cancelled",
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function dateValue(value: unknown, fallback: Date): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

function eventResource(type: string, data: Record<string, unknown>): string {
  if (type.startsWith("donation.")) return text(data.id) || text(data.support_id) || text(data.transaction_id) || "unknown";
  if (type.startsWith("extra_purchase.")) return text(data.id) || text(data.extra_id) || text(data.transaction_id) || "unknown";
  if (type.startsWith("commission_order.")) {
    return text(data.id) || text(data.commission_order_id) || text(objectValue(data.commission).id) || "unknown";
  }
  if (type.startsWith("wishlist_payment.")) {
    return text(data.id) || text(data.wishlist_payment_id) || text(objectValue(data.wishlist).id) || "unknown";
  }
  if (type.startsWith("membership.")) return text(data.id) || text(data.membership_id) || text(data.psp_id) || "unknown";
  if (type.startsWith("recurring_donation.")) {
    return text(data.transaction_id) || text(data.payment_id) || text(data.purchase_id)
      || text(data.id) || text(data.support_id) || text(data.subscription_id)
      || text(data.psp_id) || "unknown";
  }
  return text(data.id) || "unknown";
}

function itemLabel(type: string, data: Record<string, unknown>): string | null {
  if (type.startsWith("extra_purchase.")) {
    const extras = Array.isArray(data.extras) ? data.extras.map(objectValue) : [];
    const labels = extras.map((extra) => {
      const title = text(extra.title) || "Extra";
      const quantity = Math.max(1, numberValue(extra.quantity, 1));
      return quantity > 1 ? `${title} x${quantity}` : title;
    });
    return labels.length ? labels.join(", ") : text(data.extra_title) || "Extra";
  }
  if (type.startsWith("commission_order.")) {
    return text(objectValue(data.commission).name) || "Commission";
  }
  if (type.startsWith("wishlist_payment.")) {
    return text(objectValue(data.wishlist).title) || text(data.wishlist_item_name) || "Wishlist item";
  }
  if (type.startsWith("membership.")) return text(data.membership_level_name) || "Membership";
  if (type.startsWith("recurring_donation.")) return "Monthly support";
  return null;
}

export function verifyBmcSignature(rawBody: string, signature: string, secret: string): boolean {
  const supplied = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function parseBmcWebhook(rawBody: string): NormalizedBmcEvent {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  const rawType = text(parsed.type);
  if (!rawType) throw new Error("BMC event type is missing");

  const type = EVENT_ALIASES[rawType] || rawType;
  const hasEnvelope = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data);
  const data = hasEnvelope ? objectValue(parsed.data) : parsed;
  const liveMode = typeof parsed.live_mode === "boolean" ? parsed.live_mode : true;
  const providerEventId = text(parsed.event_id);
  const attempt = Math.max(1, numberValue(parsed.attempt, 1));
  const createdAt = dateValue(parsed.created, new Date());
  const resourceId = eventResource(type, data);
  const supporterName = text(data.supporter_name) || text(data.payer_name) || "Anonymous";
  const supporterId = text(data.supporter_id) || text(data.subscription_id);
  const supporterEmail = (text(data.supporter_email) || text(data.payer_email))?.toLowerCase() || null;
  const coffeeCount = Math.max(1, numberValue(
    data.coffee_count,
    data.support_coffees,
    data.subscription_coffee_num,
    1,
  ));
  let amount = numberValue(
    data.amount,
    data.total_amount_charged,
    data.extra_price,
    data.commission_order_price,
    data.wishlist_payment_price,
    data.membership_price,
  );
  if (amount <= 0) amount = numberValue(data.subscription_coffee_price) * coffeeCount;
  if (amount <= 0) amount = numberValue(data.coffee_price, data.support_coffee_price) * coffeeCount;
  const rawCurrency = (
    text(data.currency)
    || text(data.support_currency)
    || text(data.subscription_currency)
    || "USD"
  ).toUpperCase();
  const currency: BmcCurrency = rawCurrency === "INR" ? "INR" : "USD";
  const note = text(data.support_note)
    || text(data.extra_note)
    || text(data.supporter_feedback)
    || text(data.subscription_message);
  const occurredAt = dateValue(
    data.created_at ?? data.started_at ?? data.support_created_on ?? data.extra_created_on
      ?? data.commission_order_created_on ?? data.wishlist_payment_created_on
      ?? data.subscription_current_period_start ?? data.subscription_created_on,
    createdAt,
  );
  const digest = createHash("sha256").update(rawBody).digest("hex").slice(0, 24);
  const eventKey = liveMode && providerEventId
    ? `live:${providerEventId}`
    : `${liveMode ? "legacy" : "test"}:${providerEventId || "none"}:${type}:${digest}`;

  return {
    providerEventId,
    type,
    liveMode,
    attempt,
    createdAt,
    data,
    resourceId,
    supporterName,
    supporterId,
    supporterEmail,
    amount,
    currency,
    note,
    itemLabel: itemLabel(type, data),
    occurredAt,
    eventKey,
  };
}

export function bmcTransactionKeys(type: string, resourceId: string, providerEventId?: string | null): string[] {
  const slug = bmcAccountSlug();
  const kind = type.startsWith("extra_purchase.") ? "extra"
    : type.startsWith("commission_order.") ? "commission"
      : type.startsWith("wishlist_payment.") ? "wishlist"
        : type.startsWith("membership.") ? "membership"
          : type.startsWith("recurring_donation.") ? "monthly"
            : "support";
  const stableResource = type === "recurring_donation.updated" && providerEventId
    ? `event_${providerEventId}`
    : resourceId;
  return [`bmc_${kind}_${slug}_${stableResource}`, `bmc_${kind}_${stableResource}`];
}
