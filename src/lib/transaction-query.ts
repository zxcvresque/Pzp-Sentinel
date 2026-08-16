import { Prisma } from "@/generated/prisma/client";

const TX_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
const DIRECTIONS = ["IN", "OUT"] as const;
const CURRENCIES = ["INR", "USD"] as const;
const TX_TYPES = ["DONATION", "EXPENSE", "SUBSCRIPTION", "OTHER"] as const;
const METHODS = ["UPI", "RAZORPAY", "BMC", "BANK", "OTHER"] as const;

type QuerySource = Pick<URLSearchParams, "get">;

function oneOf<T extends readonly string[]>(value: string | null, values: T): T[number] | null {
  return value && values.includes(value as T[number]) ? value as T[number] : null;
}

function finiteNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const date = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function transactionWhereFromParams(
  params: QuerySource,
  options: { donorUserId?: string; forceActive?: boolean } = {},
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};
  const search = params.get("search")?.trim();
  const transactionId = params.get("transactionId")?.trim();
  const status = oneOf(params.get("status"), TX_STATUSES);
  const direction = oneOf(params.get("direction"), DIRECTIONS);
  const currency = oneOf(params.get("currency"), CURRENCIES);
  const type = oneOf(params.get("type"), TX_TYPES);
  const method = oneOf(params.get("method"), METHODS);
  const amountMin = finiteNumber(params.get("amountMin"));
  const amountMax = finiteNumber(params.get("amountMax"));
  const dateFrom = validDate(params.get("dateFrom"));
  const dateTo = validDate(params.get("dateTo"), true);
  const lifecycle = options.forceActive ? "ACTIVE" : params.get("lifecycle") || "ACTIVE";

  if (options.donorUserId) where.fromUserId = options.donorUserId;
  if (transactionId) where.id = transactionId;
  if (status) where.status = status;
  if (direction) where.direction = direction;
  if (currency) where.currency = currency;
  if (type) where.type = type;
  if (method) where.method = method;
  if (lifecycle === "VOIDED") where.voidedAt = { not: null };
  else if (lifecycle !== "ALL") where.voidedAt = null;

  if (amountMin !== null || amountMax !== null) {
    where.amount = {
      ...(amountMin !== null ? { gte: amountMin } : {}),
      ...(amountMax !== null ? { lte: amountMax } : {}),
    };
  }
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }
  if (search) {
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { fromUser: { is: { name: { contains: search, mode: "insensitive" } } } },
      { createdBy: { is: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  return where;
}

export function transactionOrderFromParams(params: QuerySource): Prisma.TransactionOrderByWithRelationInput {
  switch (params.get("sort")) {
    case "oldest": return { date: "asc" };
    case "amount_high": return { amount: "desc" };
    case "amount_low": return { amount: "asc" };
    default: return { date: "desc" };
  }
}

export function transactionPageFromParams(params: QuerySource) {
  const rawPage = Number(params.get("page") || 1);
  const rawLimit = Number(params.get("limit") || 25);
  return {
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    limit: [10, 25, 50, 100].includes(rawLimit) ? rawLimit : 25,
  };
}
