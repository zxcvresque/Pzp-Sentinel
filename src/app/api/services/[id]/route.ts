import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const body = await req.json();
  const {
    category, name, columns, entries,
    price, currency, frequency, planUrl, expiryDate, status,
  } = body;

  const data: Record<string, unknown> = {};
  if (category !== undefined) data.category = category;
  if (name !== undefined) data.name = name;
  if (columns !== undefined) data.columns = columns;
  if (entries !== undefined) data.entries = entries;
  if (price !== undefined) data.price = price != null ? new Prisma.Decimal(price) : null;
  if (currency !== undefined) data.currency = currency || null;
  if (frequency !== undefined) data.frequency = frequency || null;
  if (planUrl !== undefined) data.planUrl = planUrl || null;
  if (expiryDate !== undefined) data.expiryDate = expiryDate ? new Date(expiryDate) : null;
  if (status !== undefined) data.status = status || null;

  const service = await prisma.service.update({ where: { id }, data });

  await logAudit({
    userId: user.id,
    action: "SERVICE_UPDATE",
    entityType: "Service",
    entityId: id,
    before: existing,
    after: service,
    userName: user.name,
  });

  return NextResponse.json({ service });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await prisma.service.delete({ where: { id } });

  await logAudit({
    userId: user.id,
    action: "SERVICE_DELETE",
    entityType: "Service",
    entityId: id,
    before: existing,
    userName: user.name,
  });

  return NextResponse.json({ success: true });
}
