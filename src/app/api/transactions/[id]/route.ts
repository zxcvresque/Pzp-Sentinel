import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransaction } from "@/lib/github-log";
import { Prisma } from "@/generated/prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { amount, direction, type, method, description, date } = body;

  // Validate amount if provided
  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
  }

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  const data: Prisma.TransactionUpdateInput = {};
  if (amount !== undefined) data.amount = new Prisma.Decimal(amount);
  if (direction !== undefined) data.direction = direction;
  if (type !== undefined) data.type = type;
  if (method !== undefined) data.method = method;
  if (description !== undefined) data.description = description;
  if (date !== undefined) data.date = new Date(date);

  const before = {
    amount: transaction.amount.toString(),
    direction: transaction.direction,
    type: transaction.type,
    method: transaction.method,
    description: transaction.description,
    date: transaction.date.toISOString(),
  };

  const updated = await prisma.transaction.update({
    where: { id },
    data,
    include: { fromUser: true, createdBy: true, reviewedBy: true },
  });

  const after = {
    amount: updated.amount.toString(),
    direction: updated.direction,
    type: updated.type,
    method: updated.method,
    description: updated.description,
    date: updated.date.toISOString(),
  };

  await logAudit({
    userId: user.id,
    action: "UPDATE",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    before,
    after,
    userName: user.name,
    details: `Updated transaction: ${updated.direction} ${updated.currency} ${updated.amount}`,
  });

  // GitHub immutable log
  logTransaction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    method: updated.method,
    entityId: id,
    details: `Updated: ${updated.description}`,
  });

  return NextResponse.json({ transaction: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  if (transaction.status !== "PENDING") {
    return NextResponse.json(
      { error: "Only PENDING transactions can be deleted" },
      { status: 400 }
    );
  }

  // Delete related audit logs first, then the transaction
  await prisma.auditLog.deleteMany({ where: { transactionId: id } });
  await prisma.transaction.delete({ where: { id } });

  await logAudit({
    userId: user.id,
    action: "DELETE",
    entityType: "Transaction",
    entityId: id,
    before: {
      amount: transaction.amount.toString(),
      direction: transaction.direction,
      type: transaction.type,
      method: transaction.method,
      description: transaction.description,
      status: transaction.status,
    },
    userName: user.name,
    details: `Deleted transaction: ${transaction.direction} ${transaction.currency} ${transaction.amount} — ${transaction.description}`,
  });

  // GitHub immutable log
  logTransaction({
    action: "DELETED",
    userId: user.id,
    userName: user.name,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: id,
    details: `Deleted: ${transaction.description}`,
  });

  return NextResponse.json({ success: true });
}
