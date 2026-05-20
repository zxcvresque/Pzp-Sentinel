import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const status = searchParams.get("status");
  const direction = searchParams.get("direction");
  const search = searchParams.get("search");

  const where: Prisma.TransactionWhereInput = {};

  if (!hasRole(user.roles, "ADMIN")) {
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

  const body = await req.json();
  const { amount, currency, method, direction, type, description, proofFileId, fromUserId } = body;

  if (!amount || !description) {
    return NextResponse.json({ error: "Amount and description are required" }, { status: 400 });
  }

  if (parseFloat(amount) <= 0) {
    return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
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
  });

  return NextResponse.json({ transaction }, { status: 201 });
}
