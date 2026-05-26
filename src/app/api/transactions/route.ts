import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransaction, logProofScreenshot } from "@/lib/telegram-log";
import { logTransaction as ghLogTransaction } from "@/lib/github-log";
import { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDonor = hasRole(user.roles, "DONOR");

  // DEV role cannot access financial data
  if (!isAdmin && !isDonor) {
    return NextResponse.json({ error: "Forbidden: insufficient role for financial data" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const status = searchParams.get("status");
  const direction = searchParams.get("direction");
  const search = searchParams.get("search");

  const where: Prisma.TransactionWhereInput = {};

  // ADMIN sees all, DONOR sees only their own transactions
  if (!isAdmin) {
    where.fromUserId = user.id;
  }

  if (status) where.status = status as Prisma.EnumTxStatusFilter["equals"];
  if (direction) where.direction = direction as Prisma.EnumDirectionFilter["equals"];
  if (search) {
    where.description = { contains: search, mode: "insensitive" };
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { fromUser: true, createdBy: true, reviewedBy: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({ transactions, total, page, limit });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDonor = hasRole(user.roles, "DONOR");

  // DEV role cannot create transactions (no access to financial operations)
  if (!isAdmin && !isDonor) {
    return NextResponse.json({ error: "Forbidden: DEV role cannot create transactions" }, { status: 403 });
  }

  const body = await req.json();
  const { amount, currency, method, direction, type, description, proofFileId, fromUserId } = body;
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!amount || !description) {
    return NextResponse.json({ error: "Amount and description are required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  // DONOR can only create direction=IN (donations)
  if (isDonor && !isAdmin && direction && direction !== "IN") {
    return NextResponse.json({ error: "Forbidden: donors can only create incoming donations" }, { status: 403 });
  }

  // Validate IDs if provided
  if (fromUserId !== undefined && fromUserId !== null && (typeof fromUserId !== "string" || fromUserId.trim() === "")) {
    return NextResponse.json({ error: "fromUserId must be a non-empty string" }, { status: 400 });
  }

  const txStatus = isAdmin && direction === "OUT" ? "APPROVED" : "PENDING";

  const transaction = await prisma.transaction.create({
    data: {
      amount: new Prisma.Decimal(amount),
      currency: currency || "INR",
      method: method || "UPI",
      direction: direction || "IN",
      type: type || (direction === "IN" ? "DONATION" : "EXPENSE"),
      description,
      proofFileId: proofFileId || null,
      attachments,
      fromUserId: fromUserId || (direction === "IN" ? user.id : null),
      status: txStatus,
      createdById: user.id,
    },
    include: { fromUser: true, createdBy: true },
  });

  await logAudit({
    userId: user.id,
    action: "CREATE",
    entityType: "Transaction",
    entityId: transaction.id,
    transactionId: transaction.id,
    after: transaction,
    userName: user.name,
    details: `${transaction.direction} ${transaction.currency} ${transaction.amount}`,
  });

  logTransaction({
    id: transaction.id,
    amount: transaction.amount,
    currency: transaction.currency,
    method: transaction.method,
    direction: transaction.direction,
    type: transaction.type,
    description: transaction.description,
    status: transaction.status,
    fromUserName: transaction.fromUser?.name,
    createdByName: transaction.createdBy?.name,
  });

  // GitHub immutable log
  ghLogTransaction({
    action: "CREATED",
    userId: user.id,
    userName: user.name,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: transaction.id,
    details: `${transaction.type}: ${transaction.description}`,
  });

  if (proofFileId) {
    logProofScreenshot(transaction.id, proofFileId, description);
  }

  return NextResponse.json({ transaction }, { status: 201 });
}
