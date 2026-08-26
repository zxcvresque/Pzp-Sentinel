import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatTgMessage, notifyAdmins } from "@/lib/notifications";
import { recordFinancialEvent } from "@/lib/record-financial-event";
import { nextServiceCycleDate } from "@/lib/service-billing";

export type VpsDuration = {
  mode?: "LIFETIME" | "ONE_TIME" | "SUBSCRIPTION" | null;
  price?: number | string | null;
  currency?: "INR" | "USD" | null;
  frequency?: "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  expiryDate?: string | null;
  autoRenew?: boolean | null;
};

const RECURRING = new Set(["WEEKLY", "MONTHLY", "YEARLY"]);

export function nextCycleDate(from: Date, frequency: string | null | undefined): Date {
  return nextServiceCycleDate(from, frequency);
}

function parsePrice(value: VpsDuration["price"]): number {
  const amount = typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * Keep VPS plan metadata in Services. The first charge is created through the
 * canonical financial workflow as PENDING; balance and billing dates change
 * only after an admin approves it.
 */
export async function syncVpsSubscription(
  server: { id: string; name: string; planLink?: string | null },
  duration: VpsDuration | null | undefined,
  adminId: string,
): Promise<{ transactionId?: string }> {
  const existing = await prisma.service.findUnique({ where: { vpsServerId: server.id } });
  const amount = parsePrice(duration?.price);
  if (!duration?.mode || amount <= 0) {
    if (existing && existing.status !== "CANCELLED") {
      await prisma.service.update({ where: { id: existing.id }, data: { status: "CANCELLED", autoRenew: false } });
    }
    return {};
  }

  const frequency = duration.mode === "LIFETIME"
    ? "LIFETIME"
    : duration.mode === "ONE_TIME"
      ? "ONE_TIME"
      : duration.frequency || "MONTHLY";
  const currency = duration.currency || "INR";
  const recurring = RECURRING.has(frequency);
  const expiryDate = duration.expiryDate
    ? new Date(duration.expiryDate)
    : recurring ? nextCycleDate(new Date(), frequency) : undefined;
  if (expiryDate && Number.isNaN(expiryDate.getTime())) throw new Error("Invalid VPS plan expiry date");

  const sharedData = {
    category: "VPS",
    name: server.name,
    price: new Prisma.Decimal(amount),
    currency,
    frequency: frequency as "WEEKLY" | "MONTHLY" | "YEARLY" | "ONE_TIME" | "LIFETIME",
    planUrl: server.planLink?.trim() || null,
    expiryDate,
    autoRenew: recurring && Boolean(duration.autoRenew),
    status: "ACTIVE" as const,
  };
  if (existing) {
    await prisma.service.update({ where: { id: existing.id }, data: sharedData });
    return {};
  }

  const actor = await prisma.user.findUnique({ where: { id: adminId }, select: { name: true } });
  const result = await recordFinancialEvent({
    actorId: adminId,
    amount,
    currency,
    method: "OTHER",
    direction: "OUT",
    type: "SUBSCRIPTION",
    description: `VPS plan: ${server.name}`,
    date: new Date(),
    status: "PENDING",
    service: {
      action: "CREATE",
      name: server.name,
      category: "VPS",
      frequency,
      nextRenewal: expiryDate,
      planUrl: sharedData.planUrl || undefined,
      autoRenew: sharedData.autoRenew,
      vpsServerId: server.id,
    },
  });
  await logAudit({ userId: adminId, action: "VPS_PLAN_APPROVAL_REQUESTED", entityType: "VpsServer", entityId: server.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { serviceId: result.service?.id, amount, currency }, userName: actor?.name });
  const symbol = currency === "INR" ? "₹" : "$";
  await notifyAdmins({ type: "TX_PENDING", title: "VPS plan approval required", message: `${server.name}: approve ${symbol}${amount} before it affects the treasury.`, entityId: result.transaction.id, priority: "HIGH", actionUrl: `/admin/transactions?status=PENDING&transactionId=${result.transaction.id}`, telegramMessage: formatTgMessage("🖥 VPS plan approval", `${symbol}${amount} · ${server.name}`, "The service was recorded, but no funds have been deducted yet.") }).catch((error) => console.error("[vps-billing] approval notification failed", error));
  return { transactionId: result.transaction.id };
}
