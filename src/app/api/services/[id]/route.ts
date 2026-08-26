import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { serviceReminderRepeat } from "@/lib/service-templates";
import { isCustomRepeatUnit, isServiceFrequency } from "@/lib/service-billing";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: user ? 403 : 401 });
  }
  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { date: "desc" }, include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } } },
      paidTransaction: { include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } } },
      credentials: {
        where: { parentId: null, deletedAt: null },
        select: { id: true, platform: true, label: true, status: true, expiresAt: true, updatedAt: true },
        orderBy: { label: "asc" },
      },
      reminders: { where: { active: true }, orderBy: { nextFire: "asc" } },
      alerts: { where: { status: "OPEN" }, orderBy: [{ severity: "desc" }, { dueAt: "asc" }] },
      vpsServer: { select: { id: true, name: true } },
    },
  });
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });
  const transactions = [...service.transactions];
  if (service.paidTransaction && !transactions.some((transaction) => transaction.id === service.paidTransaction!.id)) {
    transactions.push(service.paidTransaction);
    transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
  }
  return NextResponse.json({ service: { ...service, transactions } });
}

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
    price, currency, frequency, customRepeatEvery, customRepeatUnit, planUrl, expiryDate, status, autoRenew,
  } = body;

  if (frequency && !isServiceFrequency(frequency) && !["ONE_TIME", "LIFETIME"].includes(frequency)) {
    return NextResponse.json({ error: "Invalid billing frequency" }, { status: 400 });
  }
  const effectiveFrequency = frequency !== undefined ? frequency : existing.frequency;
  const effectiveCustomEvery = customRepeatEvery !== undefined ? Number(customRepeatEvery) : existing.customRepeatEvery;
  const effectiveCustomUnit = customRepeatUnit !== undefined ? customRepeatUnit : existing.customRepeatUnit;
  if (effectiveFrequency === "CUSTOM" && (!Number.isInteger(effectiveCustomEvery) || Number(effectiveCustomEvery) <= 0 || !isCustomRepeatUnit(effectiveCustomUnit))) {
    return NextResponse.json({ error: "Custom billing needs a positive interval and time unit" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (category !== undefined) data.category = category;
  if (name !== undefined) data.name = name;
  if (columns !== undefined) data.columns = columns;
  if (entries !== undefined) data.entries = entries;
  if (price !== undefined) data.price = price != null ? new Prisma.Decimal(price) : null;
  if (currency !== undefined) data.currency = currency || null;
  if (frequency !== undefined) data.frequency = frequency || null;
  if (customRepeatEvery !== undefined || frequency !== undefined) data.customRepeatEvery = effectiveFrequency === "CUSTOM" ? Number(effectiveCustomEvery) : null;
  if (customRepeatUnit !== undefined || frequency !== undefined) data.customRepeatUnit = effectiveFrequency === "CUSTOM" ? effectiveCustomUnit : null;
  if (planUrl !== undefined) data.planUrl = planUrl || null;
  if (expiryDate !== undefined) data.expiryDate = expiryDate ? new Date(expiryDate) : null;
  if (status !== undefined) data.status = status || null;
  if (autoRenew !== undefined) data.autoRenew = autoRenew === true;

  const service = await prisma.service.update({ where: { id }, data });
  if (expiryDate !== undefined || status !== undefined) {
    await prisma.operationalAlert.updateMany({
      where: { serviceId: id, status: "OPEN", kind: { in: ["UPCOMING_RENEWAL", "OVERDUE_PAYMENT"] } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  // Keep the linked renewal reminder synchronized with service billing data.
  if (service.expiryDate && service.frequency) {
    const repeat = serviceReminderRepeat(service.frequency, service.customRepeatEvery, service.customRepeatUnit);
    if (repeat) {
      await prisma.reminder.upsert({
        where: { id: (await prisma.reminder.findFirst({ where: { serviceId: id } }))?.id ?? "missing" },
        update: {
          message: `Renew ${service.name}${service.price ? ` (${service.currency} ${service.price})` : ""}`,
          nextFire: service.expiryDate,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          active: service.status === "ACTIVE",
          recipientRoles: ["ADMIN"],
        },
        create: {
          createdById: user.id,
          message: `Renew ${service.name}${service.price ? ` (${service.currency} ${service.price})` : ""}`,
          nextFire: service.expiryDate,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          channel: "BOTH",
          active: service.status === "ACTIVE",
          recipientRoles: ["ADMIN"],
          serviceId: id,
        },
      });
    } else {
      await prisma.reminder.updateMany({ where: { serviceId: id, active: true }, data: { active: false } });
    }
  } else if (expiryDate !== undefined || frequency !== undefined || status !== undefined) {
    await prisma.reminder.updateMany({
      where: { serviceId: id, active: true },
      data: { active: false },
    });
  }

  if (existing.price != null && service.price != null && Number(service.price) > Number(existing.price)) {
    const increase = Number(service.price) - Number(existing.price);
    const fingerprint = `cost-increase:${id}:${Date.now()}`;
    await prisma.operationalAlert.create({
      data: {
        fingerprint,
        kind: "COST_INCREASE",
        severity: "HIGH",
        title: `Cost increased: ${service.name}`,
        message: `${service.currency} ${existing.price} → ${service.currency} ${service.price} (+${increase.toFixed(2)})`,
        serviceId: id,
      },
    });
    notifyAdmins({
      type: "SYSTEM",
      title: `Cost increased: ${service.name}`,
      message: `${service.currency} ${existing.price} → ${service.currency} ${service.price}`,
      entityId: id,
      priority: "HIGH",
      actionUrl: `/admin/services/${id}`,
      telegramMessage: formatTgMessage("Service cost increased", service.name, `${service.currency} ${existing.price} → ${service.currency} ${service.price}`),
    }).catch(() => {});
  }

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

  const archivedAt = new Date();
  await prisma.$transaction([
    prisma.service.update({ where: { id }, data: { archivedAt, archivedById: user.id, status: "CANCELLED", autoRenew: false } }),
    prisma.reminder.updateMany({ where: { serviceId: id, active: true }, data: { active: false } }),
    prisma.operationalAlert.updateMany({ where: { serviceId: id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: archivedAt } }),
  ]);

  await logAudit({
    userId: user.id,
    action: "SERVICE_ARCHIVE",
    entityType: "Service",
    entityId: id,
    before: existing,
    userName: user.name,
    request: req,
  });

  return NextResponse.json({ success: true });
}
