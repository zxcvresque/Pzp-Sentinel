import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { bmcAccountSlug } from "./bmc-attribution";
import type { Donation } from "./donor-bridge";
import { donorPaymentAliases, donorPaymentIdentity } from "./donor-payment-id";

export class DonationQueryError extends Error {}

/** A BMC payment exists in the ledger but its donor's complete history has not
 * passed verification. This asserts nothing about the payment: never treat it
 * as a failure, a reversal or a missing donation. */
export class BmcUnverifiedError extends Error {
  code = "BMC_HISTORY_UNVERIFIED";
  constructor() { super("This BMC payment has not been published: the donor's complete BMC history has not yet reconciled. Do not award or deduct XP; retry after the next verification."); }
}

export type DonationQuery = {
  states: Donation["state"][];
  telegramId?: string;
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
  const telegramId = params.get("telegramId");
  if (telegramId !== null && !/^[1-9]\d{0,18}$/.test(telegramId)) throw new DonationQueryError("telegramId must be a positive numeric Telegram user ID");
  const states = [...new Set((params.get("state") || "PAID|REVERSED").split("|"))];
  if (states.some(state => state !== "PAID" && state !== "REVERSED")) {
    throw new DonationQueryError("state must be PAID, REVERSED or PAID|REVERSED");
  }
  const from = params.get("from") ? timestamp(params.get("from")!, "from") : undefined;
  const to = params.get("to") ? timestamp(params.get("to")!, "to") : undefined;
  if (from && to && to < from) throw new DonationQueryError("to must be on or after from");
  return {
    states: states as Donation["state"][],
    ...(telegramId ? { telegramId } : {}),
    from,
    to,
    limit: integer(params.get("limit"), 100, 1, 500, "limit"),
    offset: integer(params.get("offset"), 0, 0, 2147483647, "offset"),
  };
}

export const donationSelect = {
  id: true, method: true, providerPaymentId: true, bmcEventId: true,
  amount: true, currency: true, date: true, donationFrequency: true,
  voidedAt: true, voidReason: true, providerState: true,
  bmcPaymentConfirmed: true, bridgeDonationId: true, bmcHistoryPaymentId: true, bmcHistorySupportId: true, bmcPaidDate: true, bmcReviewReason: true,
  fromUser: { select: { telegramId: true, name: true } },
  razorpayOrder: { select: {
    paymentId: true, invite: { select: { telegramId: true, guestName: true } },
  } },
} satisfies Prisma.TransactionSelect;
const bridgeSelect = { ...donationSelect, bmcBridgePublication: { select: { payload: true } } } satisfies Prisma.TransactionSelect;

export type DonationRow = Prisma.TransactionGetPayload<{ select: typeof donationSelect }>;
type BridgeRow = Prisma.TransactionGetPayload<{ select: typeof bridgeSelect }>;
export type BridgeDonation = ReturnType<typeof serializeLedgerDonation>;

const reversed: Prisma.TransactionWhereInput = {
  OR: [
    { voidedAt: { not: null } },
    ...["REFUND", "REVERSE", "DISPUTE", "FAILED"].map(value => ({
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

/** Live ledger view. Served directly for Razorpay/manual rows; for BMC rows it is
 * only the input to a verified publication (see bmc-donor-gate.ts). */
export function serializeLedgerDonation(row: DonationRow) {
  const identity = donorPaymentIdentity(row.method, row.providerPaymentId || row.razorpayOrder?.paymentId || row.bmcEventId, row.id, row.bridgeDonationId);
  const unconfirmed = row.method === "BMC" && (!row.bmcPaymentConfirmed || !!row.bmcReviewReason);
  const isReversed = !!row.voidedAt || /REFUND|REVERSE|DISPUTE|FAILED/i.test(row.providerState);
  const rawTelegramId = row.fromUser?.telegramId || row.razorpayOrder?.invite?.telegramId || null;
  const telegramId = rawTelegramId && /^[1-9]\d{0,18}$/.test(rawTelegramId) ? rawTelegramId : null;
  return {
    ...identity,
    donorKey: telegramId ? `telegram:${telegramId}` : null,
    idempotencyKey: `sentinel:transaction:${row.id}`,
    aliases: donorPaymentAliases(row.method, row.id, [row.providerPaymentId, row.bmcEventId, row.bmcHistoryPaymentId, row.bmcHistorySupportId]),
    transactionId: row.id,
    telegramId,
    name: row.fromUser?.name || row.razorpayOrder?.invite?.guestName || "Unmatched donor",
    amount: row.amount.toString(),
    currency: row.currency,
    // USD conversion is deliberately resolved via /api/exchange-rate. The ledger
    // has no historical FX rate, so never invent one or persist a current estimate.
    inrEstimate: row.currency === "INR" ? row.amount.toString() : null,
    fxRate: row.currency === "INR" ? "1" : null,
    occurredAt: row.date.toISOString(),
    paymentDate: row.method === "BMC" ? row.bmcPaidDate || row.date.toISOString().slice(0, 10) : row.date.toISOString().slice(0, 10),
    paymentDateTimeZone: "UTC",
    frequency: row.donationFrequency,
    state: isReversed ? "REVERSED" as const : "PAID" as const,
    lifecycle: row.voidedAt ? "VOIDED" : "ACTIVE",
    paymentConfirmed: !unconfirmed && !isReversed,
    verificationStatus: isReversed ? "REVERSED" : unconfirmed ? "REQUIRES_REVIEW" : "CONFIRMED",
    xpEligible: !!telegramId && !unconfirmed && !isReversed,
    reviewReason: unconfirmed && !isReversed ? row.bmcReviewReason || "Check BMC paid charge history before awarding new XP. Missing confirmation does not establish a failed payment or justify deducting existing XP." : !telegramId && !isReversed ? "A verified Telegram user ID is required before awarding XP." : null,
    reversalReason: isReversed ? row.voidReason || (row.voidedAt ? "Voided in Sentinel" : row.providerState) : null,
  };
}

// BMC rows are served exclusively from their frozen verified publication.
// An unpublished BMC row is not part of any bridge response.
function serializeBridgeDonation(row: BridgeRow): BridgeDonation | null {
  if (row.method !== "BMC") return serializeLedgerDonation(row);
  const payload = row.bmcBridgePublication?.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as unknown as BridgeDonation : null;
}

function donorWhere(telegramId: string): Prisma.TransactionWhereInput {
  // Registered attribution wins over an older guest invitation. Neither names
  // nor email addresses are donor identities.
  return { OR: [
    { fromUser: { is: { telegramId } } },
    { fromUserId: null, razorpayOrder: { is: { invite: { is: { telegramId } } } } },
  ] };
}

type SummaryClient = Pick<Prisma.TransactionClient, "transaction" | "bmcBridgePublication" | "bmcDonorVerification">;

export async function donorDonationSummary(telegramId: string, db: SummaryClient = prisma) {
  const live = { ...eligible(), method: { not: "BMC" as const }, AND: [donorWhere(telegramId)] };
  // Counts are for the donor's entire history, independently of list pagination
  // and date filters. Decimal totals stay in the original currencies. BMC
  // figures come only from the donor's last verified publication.
  const [liveTotals, liveReversed, bmcTotals, bmcReversed, unpublished, verification] = await Promise.all([
    db.transaction.groupBy({ by: ["currency"], orderBy: { currency: "asc" }, where: { ...live, AND: [...live.AND, { NOT: reversed }] }, _count: { _all: true }, _sum: { amount: true } }),
    db.transaction.count({ where: { ...live, AND: [...live.AND, reversed] } }),
    db.bmcBridgePublication.groupBy({ by: ["currency"], orderBy: { currency: "asc" }, where: { telegramId, state: "PAID" }, _count: { _all: true }, _sum: { amount: true } }),
    db.bmcBridgePublication.count({ where: { telegramId, state: "REVERSED" } }),
    db.transaction.count({ where: { ...eligible(), method: "BMC", bmcBridgePublication: { is: null }, AND: [donorWhere(telegramId), { NOT: reversed }] } }),
    db.bmcDonorVerification.findFirst({ where: { user: { is: { telegramId } } }, select: { status: true, issues: true, lastAttemptAt: true, lastVerifiedAt: true, historyFetchedAt: true } }),
  ]);
  const totals = new Map<string, { amount: Prisma.Decimal; donationCount: number }>();
  for (const row of [...liveTotals, ...bmcTotals]) {
    const total = totals.get(row.currency) || { amount: new Prisma.Decimal(0), donationCount: 0 };
    total.amount = total.amount.plus(row._sum.amount?.toString() || "0"); total.donationCount += row._count._all;
    totals.set(row.currency, total);
  }
  const issues = Array.isArray(verification?.issues) ? (verification.issues as Array<{ code?: string }>).flatMap(issue => issue?.code ? [issue.code] : []) : [];
  return { telegramId, donorKey: `telegram:${telegramId}`,
    donationCount: [...totals.values()].reduce((sum, row) => sum + row.donationCount, 0),
    // Ledger BMC payments awaiting verification: neither paid nor failed for XP purposes.
    reviewCount: unpublished, reversedCount: liveReversed + bmcReversed,
    totals: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, row]) => ({ currency, amount: row.amount.toString(), donationCount: row.donationCount })),
    bmcVerification: {
      status: verification?.status || (unpublished ? "UNVERIFIED" : "NOT_APPLICABLE"),
      upToDate: verification?.status === "VERIFIED" && unpublished === 0,
      unpublishedCount: unpublished, issues: [...new Set(issues)].sort(),
      lastVerifiedAt: verification?.lastVerifiedAt?.toISOString() || null,
      lastAttemptAt: verification?.lastAttemptAt?.toISOString() || null,
      historyFetchedAt: verification?.historyFetchedAt?.toISOString() || null,
    } };
}

export async function listDonations(query: DonationQuery) {
  if (query.telegramId) return prisma.$transaction(db => listDonationPage(query, db), { isolationLevel: "RepeatableRead" });
  return listDonationPage(query, prisma);
}

async function listDonationPage(query: DonationQuery, db: SummaryClient) {
  const live: Prisma.TransactionWhereInput = {
    ...eligible(query.from, query.to), method: { not: "BMC" },
    AND: [
      ...(query.telegramId ? [donorWhere(query.telegramId)] : []),
      ...(query.states.length === 1 ? [query.states[0] === "REVERSED" ? reversed : { NOT: reversed }] : []),
    ],
  };
  // BMC rows are filtered on their published facts, never on live ledger columns.
  const published: Prisma.TransactionWhereInput = { method: "BMC", isTest: false, bmcBridgePublication: { is: {
    ...(query.telegramId ? { telegramId: query.telegramId } : {}),
    ...(query.states.length === 1 ? { state: query.states[0] } : {}),
    ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
  } } };
  const where: Prisma.TransactionWhereInput = { OR: [live, published] };
  // One bounded live read. No feed refresh, provider sweep, cursor or mirror tables.
  const rows = await db.transaction.findMany({
    where, select: bridgeSelect,
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: query.limit + 1, skip: query.offset,
  });
  const hasMore = rows.length > query.limit;
  return {
    donations: rows.slice(0, query.limit).flatMap(row => serializeBridgeDonation(row) || []),
    ...(query.telegramId ? { donor: await donorDonationSummary(query.telegramId, db) } : {}),
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
      ...(provider === "bmc" ? [{ bmcHistoryPaymentId: { in: [...references] } }, { bmcHistorySupportId: paymentId }] : []),
      { razorpayOrder: { is: { paymentId: { in: [...references] } } } },
    ],
  };
}

export async function getDonation(id: string) {
  const identity = identityWhere(id);
  if (!identity) return null;
  const rows = await prisma.transaction.findMany({
    where: { AND: [{ isTest: false, direction: "IN", type: "DONATION" }, { OR: [{ bridgeDonationId: id }, identity] }] },
    select: { ...bridgeSelect, status: true },
    // Each candidate reference is unique in the ledger. Do not scan donation history.
  });
  const matches: BridgeDonation[] = [];
  let unverified = false;
  for (const row of rows) {
    const ledger = serializeLedgerDonation(row);
    const named = (d: BridgeDonation) => d.id === id || d.transactionId === id || (d.provider === "bmc" && d.aliases.includes(id));
    if (row.method !== "BMC") {
      if (row.status === "APPROVED" && Number(row.amount) > 0 && named(ledger)) matches.push(ledger);
      continue;
    }
    if (!named(ledger) && !(row.bmcBridgePublication && named(serializeBridgeDonation(row)!))) continue;
    const published = serializeBridgeDonation(row);
    if (published) matches.push(published);
    else if (row.status === "APPROVED" && Number(row.amount) > 0) unverified = true;
  }
  if (matches.length > 1) throw new Error("Ambiguous donation identity");
  if (!matches.length && unverified) throw new BmcUnverifiedError();
  return matches[0] || null;
}
