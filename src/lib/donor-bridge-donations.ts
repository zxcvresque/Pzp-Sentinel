import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { bmcAccountSlug } from "./bmc-attribution";
import type { Donation } from "./donor-bridge";
import { donorPaymentIdentity } from "./donor-payment-id";

export class DonationQueryError extends Error {}

export type DonationQuery = {
  states: Donation["state"][];
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

function timestamp(value: string, field: string): Date {
  // Require an explicit timezone; a server's local timezone must not change eligibility.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new DonationQueryError(`${field} must be an ISO timestamp with a timezone`);
  }
  const date = new Date(value);
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new DonationQueryError(`Invalid ${field} timestamp`);
  }
  return date;
}

function integer(value: string | null, fallback: number, min: number, max: number, field: string) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new DonationQueryError(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function parseDonationQuery(params: URLSearchParams): DonationQuery {
  const states = [...new Set((params.get("state") || "PAID|REVERSED").split("|"))];
  if (states.some(state => state !== "PAID" && state !== "REVERSED")) {
    throw new DonationQueryError("state must be PAID, REVERSED or PAID|REVERSED");
  }
  const from = params.get("from") ? timestamp(params.get("from")!, "from") : undefined;
  const to = params.get("to") ? timestamp(params.get("to")!, "to") : undefined;
  if (from && to && to < from) throw new DonationQueryError("to must be on or after from");
  return {
    states: states as Donation["state"][],
    from,
    to,
    limit: integer(params.get("limit"), 100, 1, 500, "limit"),
    offset: integer(params.get("offset"), 0, 0, 2147483647, "offset"),
  };
}

const donationSelect = {
  id: true, method: true, providerPaymentId: true, bmcEventId: true,
  amount: true, currency: true, date: true, donationFrequency: true,
  voidedAt: true, voidReason: true, providerState: true,
  fromUser: { select: { telegramId: true, name: true } },
  razorpayOrder: { select: {
    paymentId: true, invite: { select: { telegramId: true, guestName: true } },
  } },
} satisfies Prisma.TransactionSelect;

type DonationRow = Prisma.TransactionGetPayload<{ select: typeof donationSelect }>;

const reversed: Prisma.TransactionWhereInput = {
  OR: [
    { voidedAt: { not: null } },
    ...["REFUND", "REVERSE", "DISPUTE"].map(value => ({
      providerState: { contains: value, mode: "insensitive" as const },
    })),
  ],
};

function eligible(from?: Date, to?: Date): Prisma.TransactionWhereInput {
  return {
    isTest: false, direction: "IN", type: "DONATION", status: "APPROVED",
    amount: { gt: 0 },
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}

function serializeDonation(row: DonationRow) {
  const identity = donorPaymentIdentity(row.method, row.providerPaymentId || row.razorpayOrder?.paymentId || row.bmcEventId, row.id);
  const isReversed = !!row.voidedAt || /REFUND|REVERSE|DISPUTE/i.test(row.providerState);
  return {
    ...identity,
    transactionId: row.id,
    telegramId: row.fromUser?.telegramId || row.razorpayOrder?.invite?.telegramId || null,
    name: row.fromUser?.name || row.razorpayOrder?.invite?.guestName || "Unmatched donor",
    amount: row.amount.toString(),
    currency: row.currency,
    // USD conversion is deliberately resolved via /api/exchange-rate. The ledger
    // has no historical FX rate, so never invent one or persist a current estimate.
    inrEstimate: row.currency === "INR" ? row.amount.toString() : null,
    fxRate: row.currency === "INR" ? "1" : null,
    occurredAt: row.date.toISOString(),
    frequency: row.donationFrequency,
    state: isReversed ? "REVERSED" as const : "PAID" as const,
    lifecycle: row.voidedAt ? "VOIDED" : "ACTIVE",
    reversalReason: isReversed ? row.voidReason || (row.voidedAt ? "Voided in Sentinel" : row.providerState) : null,
  };
}

export async function listDonations(query: DonationQuery) {
  const where: Prisma.TransactionWhereInput = {
    ...eligible(query.from, query.to),
    ...(query.states.length === 1 ? {
      AND: [query.states[0] === "REVERSED" ? reversed : { NOT: reversed }],
    } : {}),
  };
  // One bounded live read. No feed refresh, provider sweep, cursor or mirror tables.
  const rows = await prisma.transaction.findMany({
    where, select: donationSelect,
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: query.limit + 1, skip: query.offset,
  });
  const hasMore = rows.length > query.limit;
  return {
    donations: rows.slice(0, query.limit).map(serializeDonation),
    limit: query.limit, offset: query.offset, hasMore,
    nextOffset: hasMore ? query.offset + query.limit : null,
    cutoff: null,
  };
}

function identityWhere(id: string): Prisma.TransactionWhereInput | null {
  if (!id || id.length > 512) return null;
  const separator = id.indexOf(":");
  if (separator === -1) return { id }; // Also accept the immutable transactionId.
  const provider = id.slice(0, separator), paymentId = id.slice(separator + 1);
  if (!paymentId || !["manual", "razorpay", "bmc"].includes(provider)) return null;
  const references = new Set([paymentId]);
  if (provider === "bmc") {
    // Reverse the same BMC normalization used by the event feed and CSV export.
    references.add(`bmc_support_${paymentId}`);
    references.add(`bmc_support_${bmcAccountSlug()}_${paymentId}`);
    for (const kind of ["monthly", "membership", "extra", "commission", "wishlist"]) {
      const prefix = `bmc_${kind}_`;
      if (paymentId.startsWith(prefix)) {
        references.add(`${prefix}${bmcAccountSlug()}_${paymentId.slice(prefix.length)}`);
      }
    }
  }
  return {
    method: provider === "razorpay" ? "RAZORPAY" : provider === "bmc" ? "BMC" : { notIn: ["RAZORPAY", "BMC"] },
    OR: [
      { id: paymentId },
      { providerPaymentId: { in: [...references] } },
      { bmcEventId: { in: [...references] } },
      { razorpayOrder: { is: { paymentId: { in: [...references] } } } },
    ],
  };
}

export async function getDonation(id: string) {
  const identity = identityWhere(id);
  if (!identity) return null;
  const rows = await prisma.transaction.findMany({
    where: { AND: [eligible(), identity] }, select: donationSelect,
    // Each candidate reference is unique in the ledger. Do not scan donation history.
  });
  const matches = rows.map(serializeDonation).filter(d => d.id === id || d.transactionId === id);
  if (matches.length > 1) throw new Error("Ambiguous donation identity");
  return matches[0] || null;
}
