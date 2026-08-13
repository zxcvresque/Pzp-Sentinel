import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";
import { logTransaction as logTelegramTransaction } from "@/lib/telegram-log";
import { logTransaction as logGithubTransaction } from "@/lib/github-log";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";

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
    recordPayment, paymentMethod, paymentDate,
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
  if (recordPayment === true && parsedPrice == null) {
    return NextResponse.json({ error: "Enter a service price before recording its payment" }, { status: 400 });
  }
  const validPaymentMethods = ["OTHER", "BANK", "UPI"] as const;
  const selectedPaymentMethod = validPaymentMethods.includes(paymentMethod)
    ? paymentMethod as (typeof validPaymentMethods)[number]
    : "OTHER";
  const paidAt = paymentDate ? new Date(paymentDate) : new Date();
  if (recordPayment === true && Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "Invalid payment date" }, { status: 400 });
  }

  const { service, payment } = await prisma.$transaction(async (db) => {
    const payment = recordPayment === true ? await db.transaction.create({
      data: {
        amount: new Prisma.Decimal(parsedPrice!),
        currency: currency || "INR",
        method: selectedPaymentMethod,
        direction: "OUT",
        type: "SUBSCRIPTION",
        description: `Service payment: ${name.trim()}`,
        date: paidAt,
        status: "APPROVED",
        createdById: user.id,
      },
    }) : null;

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
        paidTxId: payment?.id,
        lastRenewalDate: payment ? paidAt : undefined,
      },
    });

    return { service, payment };
  });

  await logAudit({
    userId: user.id,
    action: "SERVICE_CREATE",
    entityType: "Service",
    entityId: service.id,
    after: service,
    userName: user.name,
  });

  if (payment) {
    await logAudit({
      userId: user.id,
      action: "CREATE",
      entityType: "Transaction",
      entityId: payment.id,
      transactionId: payment.id,
      after: payment,
      userName: user.name,
      details: `OUT ${payment.currency} ${payment.amount} — ${payment.description}`,
    });
    logTelegramTransaction({
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      direction: payment.direction,
      type: payment.type,
      description: payment.description,
      status: payment.status,
      identityName: user.name,
      identityTelegramUser: user.telegramUser,
      identityTelegramId: user.telegramId,
      createdByName: user.name,
    });
    logGithubTransaction({
      action: "CREATED",
      userId: user.id,
      userName: user.name,
      amount: payment.amount.toString(),
      currency: payment.currency,
      direction: payment.direction,
      method: payment.method,
      entityId: payment.id,
      details: `SUBSCRIPTION: ${payment.description}`,
    });
    scheduleFinanceAutomation({
      action: "CREATED",
      actorName: user.name,
      transactionId: payment.id,
      sendBackup: true,
    });
  }

  return NextResponse.json({ service, payment }, { status: 201 });
}
