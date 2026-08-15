import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { encryptSecret } from "@/lib/secret-crypto";
import { serviceReminderRepeat, serviceTemplate } from "@/lib/service-templates";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { logAudit } from "@/lib/audit";
import { logTransaction as logTelegramTransaction } from "@/lib/telegram-log";
import { logTransaction as logGithubTransaction } from "@/lib/github-log";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";

const PAYMENT_METHODS = ["OTHER", "BANK", "UPI"] as const;
const FREQUENCIES = ["WEEKLY", "MONTHLY", "YEARLY"] as const;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const kind = body?.kind === "RECURRING" ? "RECURRING" : body?.kind === "ONE_TIME" ? "ONE_TIME" : null;
  const amount = Number(body?.amount);
  const currency = body?.currency === "USD" ? "USD" : body?.currency === "INR" ? "INR" : null;
  const method = PAYMENT_METHODS.includes(body?.method) ? body.method as (typeof PAYMENT_METHODS)[number] : null;
  const paymentDate = new Date(body?.paymentDate);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const attachments = Array.isArray(body?.attachments)
    ? body.attachments.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : [];

  if (!kind || !Number.isFinite(amount) || amount <= 0 || !currency || !method || !description || Number.isNaN(paymentDate.getTime())) {
    return NextResponse.json({ error: "Complete the purchase type, amount, currency, payment source, date and description" }, { status: 400 });
  }
  if (attachments.length > 10) {
    return NextResponse.json({ error: "A purchase can contain at most 10 attachments" }, { status: 400 });
  }

  const template = serviceTemplate(body?.templateId);
  const frequency = FREQUENCIES.includes(body?.frequency) ? body.frequency as (typeof FREQUENCIES)[number] : null;
  const nextRenewal = body?.nextRenewal ? new Date(body.nextRenewal) : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const planUrl = typeof body?.planUrl === "string" ? body.planUrl.trim() : "";
  const metadata = body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, string>
    : {};
  const rawCredentials: unknown[] = Array.isArray(body?.credentials) ? body.credentials : [];
  const credentials = rawCredentials.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      platform: typeof item.platform === "string" ? item.platform.trim() : serviceName,
      label: typeof item.label === "string" ? item.label.trim() : "",
      value: typeof item.value === "string" ? item.value : "",
      expiresAt: item.expiresAt ? new Date(String(item.expiresAt)) : null,
    };
  }).filter((entry) => entry.label && entry.value);

  if (kind === "RECURRING" && (
    !serviceName || !category || !frequency || !nextRenewal || Number.isNaN(nextRenewal.getTime())
  )) {
    return NextResponse.json({ error: "Recurring purchases require service name, category, frequency and next renewal" }, { status: 400 });
  }
  if (credentials.length > 10 || credentials.some((credential) => credential.expiresAt && Number.isNaN(credential.expiresAt.getTime()))) {
    return NextResponse.json({ error: "Enter at most 10 credentials with valid expiry dates" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (db) => {
    const service = kind === "RECURRING" ? await db.service.create({
      data: {
        category,
        name: serviceName,
        columns: template?.metadata ?? undefined,
        entries: Object.keys(metadata).length ? [metadata] : undefined,
        price: new Prisma.Decimal(amount),
        currency,
        frequency,
        planUrl: planUrl || undefined,
        expiryDate: nextRenewal!,
        lastRenewalDate: paymentDate,
        status: "ACTIVE",
        attachments,
      },
    }) : null;

    const transaction = await db.transaction.create({
      data: {
        amount: new Prisma.Decimal(amount),
        currency,
        method,
        direction: "OUT",
        type: kind === "RECURRING" ? "SUBSCRIPTION" : "EXPENSE",
        description,
        date: paymentDate,
        status: "APPROVED",
        attachments,
        createdById: user.id,
        serviceId: service?.id,
      },
    });

    let reminder = null;
    const createdCredentials: Array<{ id: string; platform: string; label: string; expiresAt: Date | null }> = [];
    if (service) {
      await db.service.update({ where: { id: service.id }, data: { paidTxId: transaction.id } });
      const repeat = serviceReminderRepeat(frequency);
      reminder = repeat ? await db.reminder.create({
        data: {
          createdById: user.id,
          message: `Renew ${serviceName} (${currency} ${amount})`,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          nextFire: nextRenewal!,
          channel: "BOTH",
          recipientRoles: ["ADMIN"],
          serviceId: service.id,
        },
      }) : null;
      for (const credential of credentials) {
        const created = await db.credential.create({
          data: {
            platform: credential.platform || serviceName,
            label: credential.label,
            value: encryptSecret(credential.value),
            status: "APPROVED",
            createdById: user.id,
            serviceId: service.id,
            expiresAt: credential.expiresAt,
          },
          select: { id: true, platform: true, label: true, expiresAt: true },
        });
        createdCredentials.push(created);
      }
    }
    return { service, transaction, reminder, credentials: createdCredentials };
  });

  await logAudit({
    userId: user.id,
    action: "PURCHASE_RECORDED",
    entityType: result.service ? "Service" : "Transaction",
    entityId: result.service?.id ?? result.transaction.id,
    transactionId: result.transaction.id,
    after: {
      kind,
      serviceId: result.service?.id,
      transactionId: result.transaction.id,
      reminderId: result.reminder?.id,
      credentialIds: result.credentials.map((credential) => credential.id),
    },
    userName: user.name,
    details: `${kind}: ${description}`,
  });
  logTelegramTransaction({
    id: result.transaction.id,
    amount: result.transaction.amount,
    currency: result.transaction.currency,
    method: result.transaction.method,
    direction: result.transaction.direction,
    type: result.transaction.type,
    description: result.transaction.description,
    status: result.transaction.status,
    identityName: user.name,
    identityTelegramUser: user.telegramUser,
    identityTelegramId: user.telegramId,
    createdByName: user.name,
  });
  logGithubTransaction({
    action: "CREATED",
    userId: user.id,
    userName: user.name,
    amount: result.transaction.amount.toString(),
    currency: result.transaction.currency,
    direction: result.transaction.direction,
    method: result.transaction.method,
    entityId: result.transaction.id,
    details: `${result.transaction.type}: ${description}`,
  });
  const attachmentArchive = attachments.length
    ? await archiveTransactionAttachmentsToTelegram(result.transaction)
    : [];
  scheduleFinanceAutomation({
    action: "CREATED",
    actorName: user.name,
    transactionId: result.transaction.id,
    sendBackup: true,
  });

  return NextResponse.json({ ...result, attachmentArchive }, { status: 201 });
}
