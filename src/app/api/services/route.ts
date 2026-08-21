import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { serviceReminderRepeat } from "@/lib/service-templates";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const services = await prisma.service.findMany({
    where: { archivedAt: null },
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

  if (currency && !["INR", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  const parsedPrice = price != null ? Number(price) : null;
  if (price != null && (!Number.isFinite(parsedPrice) || parsedPrice! <= 0)) {
    return NextResponse.json({ error: "Price must be a positive number" }, { status: 400 });
  }
  const service = await prisma.$transaction(async (db) => {
    const service = await db.service.create({
      data: {
        category,
        name,
        columns: columns ?? undefined,
        entries: entries ?? undefined,
        price: parsedPrice != null ? new Prisma.Decimal(parsedPrice) : undefined,
        currency: currency || undefined,
        frequency: frequency || undefined,
        planUrl: planUrl || undefined,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        status: status || undefined,
      },
    });
    const repeat = serviceReminderRepeat(service.frequency);
    if (service.expiryDate && repeat) {
      await db.reminder.create({
        data: {
          createdById: user.id,
          message: `Renew ${service.name}${service.price ? ` (${service.currency} ${service.price})` : ""}`,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          nextFire: service.expiryDate,
          channel: "BOTH",
          recipientRoles: ["ADMIN"],
          serviceId: service.id,
        },
      });
    }

    return service;
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
