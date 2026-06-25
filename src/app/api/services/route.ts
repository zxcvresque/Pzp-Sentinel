import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const services = await prisma.service.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { vpsServer: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ services });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    category, name, columns, entries,
    price, currency, frequency, planUrl, expiryDate, status,
  } = body;

  if (!category || !name) {
    return NextResponse.json(
      { error: "category and name are required" },
      { status: 400 },
    );
  }

  const service = await prisma.service.create({
    data: {
      category,
      name,
      columns: columns ?? undefined,
      entries: entries ?? undefined,
      price: price != null ? new Prisma.Decimal(price) : undefined,
      currency: currency || undefined,
      frequency: frequency || undefined,
      planUrl: planUrl || undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      status: status || undefined,
    },
  });

  await logAudit({
    userId: user.id,
    action: "SERVICE_CREATE",
    entityType: "Service",
    entityId: service.id,
    after: service,
    userName: user.name,
  });

  return NextResponse.json({ service }, { status: 201 });
}
