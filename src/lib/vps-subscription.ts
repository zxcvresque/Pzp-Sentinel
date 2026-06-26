import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/**
 * Duration / billing block submitted from the VPS add/edit form.
 * - LIFETIME  → one-time purchase (frequency ONE_TIME, no expiry, never auto-renews).
 * - SUBSCRIPTION → recurring (frequency WEEKLY/MONTHLY/YEARLY, expiry, optional auto-renew).
 * A `price > 0` is what triggers a Services-tab row + an immediate balance deduction.
 */
export type VpsDuration = {
  // LIFETIME = pay once, never expires. ONE_TIME = pay once, optional expiry, no
  // recurrence. SUBSCRIPTION = recurring rate + cycle + expiry (+ optional auto-renew).
  mode?: "LIFETIME" | "ONE_TIME" | "SUBSCRIPTION" | null;
  price?: number | string | null;
  currency?: "INR" | "USD" | null;
  frequency?: "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  expiryDate?: string | null; // ISO date
  autoRenew?: boolean | null;
};

const RECURRING = new Set(["WEEKLY", "MONTHLY", "YEARLY"]);

/** Advance a date by one billing cycle. ONE_TIME / unknown → unchanged. */
export function nextCycleDate(from: Date, frequency: string | null | undefined): Date {
  const d = new Date(from);
  switch (frequency) {
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      return d;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return d;
  }
}

function parsePrice(value: VpsDuration["price"]): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Mirror a VPS server's plan into the Services/subscriptions tab and (on first
 * attach) deduct the price from the current balance as an APPROVED OUT expense.
 *
 * - First time a priced plan is attached (no linked Service yet) → create the
 *   Service + the immediate deduction transaction (linked via `paidTxId`).
 * - Subsequent edits update the Service fields only — NO re-charge (use the
 *   "Renew now" action or auto-renew for additional deductions).
 * - Clearing the plan / removing the price → mark the linked Service CANCELLED
 *   (kept, not deleted, so transaction history survives).
 *
 * The VpsServer row stays the source of truth for `planLink`; this Service row is
 * the finance-tab view. Services created directly in the Services tab have no
 * `vpsServerId` and are never touched here.
 */
export async function syncVpsSubscription(
  server: { id: string; name: string; planLink?: string | null },
  duration: VpsDuration | null | undefined,
  adminId: string,
): Promise<void> {
  const existing = await prisma.service.findUnique({ where: { vpsServerId: server.id } });

  const price = parsePrice(duration?.price);
  const wantBilling = !!(duration && duration.mode && price > 0);

  if (!wantBilling) {
    if (existing && existing.status !== "CANCELLED") {
      await prisma.service.update({
        where: { id: existing.id },
        data: { status: "CANCELLED", autoRenew: false },
      });
    }
    return;
  }

  const mode = duration!.mode;
  const isSubscription = mode === "SUBSCRIPTION";
  const frequency = (
    mode === "LIFETIME" ? "LIFETIME" : mode === "ONE_TIME" ? "ONE_TIME" : duration!.frequency || "MONTHLY"
  ) as "WEEKLY" | "MONTHLY" | "YEARLY" | "ONE_TIME" | "LIFETIME";
  const currency = (duration!.currency || "INR") as "INR" | "USD";
  const autoRenew = isSubscription && RECURRING.has(frequency) ? !!duration!.autoRenew : false;
  const planUrl = (server.planLink || "").trim() || null;

  let expiryDate: Date | null = null;
  if (isSubscription) {
    expiryDate = duration!.expiryDate ? new Date(duration!.expiryDate) : nextCycleDate(new Date(), frequency);
  } else if (mode === "ONE_TIME" && duration!.expiryDate) {
    // One-time purchases may carry a term/expiry but never auto-charge.
    expiryDate = new Date(duration!.expiryDate);
  }

  const sharedData = {
    category: "VPS",
    name: server.name,
    price: new Prisma.Decimal(price),
    currency,
    frequency,
    planUrl,
    expiryDate,
    autoRenew,
    status: "ACTIVE" as const,
  };

  if (existing) {
    // Edit: update plan details without re-charging.
    await prisma.service.update({ where: { id: existing.id }, data: sharedData });
    return;
  }

  // First attach: deduct now, then create the linked Service.
  const tx = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal(price),
      currency,
      method: "OTHER",
      direction: "OUT",
      type: "SUBSCRIPTION",
      description: `VPS plan: ${server.name}`,
      status: "APPROVED",
      date: new Date(),
      createdById: adminId,
    },
  });

  await prisma.service.create({
    data: {
      ...sharedData,
      vpsServerId: server.id,
      paidTxId: tx.id,
      lastRenewalDate: new Date(),
    },
  });
}
