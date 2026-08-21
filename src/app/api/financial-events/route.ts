import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordFinancialEvent } from "@/lib/record-financial-event";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { logAudit } from "@/lib/audit";
import { logTransaction as logTelegramTransaction } from "@/lib/telegram-log";
import { logTransaction as logGithubTransaction } from "@/lib/github-log";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";

const MODES = ["INCOME", "PURCHASE", "SUBSCRIPTION", "RENEWAL", "REVERSAL", "ADJUSTMENT"] as const;
const METHODS = ["OTHER", "BANK", "UPI"] as const;
const FREQUENCIES = ["WEEKLY", "MONTHLY", "YEARLY"] as const;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Only admins can record financial events" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const mode = MODES.includes(body?.mode) ? body.mode as (typeof MODES)[number] : null;
  const amount = Number(body?.amount);
  const currency = body?.currency === "USD" ? "USD" : body?.currency === "INR" ? "INR" : null;
  const method = METHODS.includes(body?.method) ? body.method as (typeof METHODS)[number] : null;
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const date = body?.date ? new Date(body.date) : new Date();
  const attachments: string[] = Array.isArray(body?.attachments)
    ? [...new Set<string>((body.attachments as unknown[]).filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0))]
    : [];

  if (!mode || !(amount > 0) || !currency || !method || !description || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Complete the transaction type, amount, currency, payment source, date and description" }, { status: 400 });
  }
  if (attachments.length > 10) return NextResponse.json({ error: "Add at most 10 documents" }, { status: 400 });

  let direction: "IN" | "OUT" = mode === "INCOME" ? "IN" : "OUT";
  let type: "DONATION" | "EXPENSE" | "SUBSCRIPTION" | "OTHER" = mode === "INCOME"
    ? "DONATION"
    : mode === "SUBSCRIPTION" || mode === "RENEWAL"
      ? "SUBSCRIPTION"
      : mode === "ADJUSTMENT" ? "OTHER" : "EXPENSE";
  if (mode === "ADJUSTMENT") direction = body?.direction === "IN" ? "IN" : "OUT";
  let reversalOfId: string | null = null;

  if (mode === "REVERSAL") {
    reversalOfId = typeof body?.reversalOfId === "string" ? body.reversalOfId : null;
    const original = reversalOfId ? await prisma.transaction.findUnique({ where: { id: reversalOfId } }) : null;
    if (!original || original.voidedAt || original.status !== "APPROVED") {
      return NextResponse.json({ error: "Choose an approved active transaction to reverse" }, { status: 400 });
    }
    if (await prisma.transaction.findFirst({ where: { reversalOfId: original.id, voidedAt: null } })) {
      return NextResponse.json({ error: "This transaction already has a reversal" }, { status: 409 });
    }
    direction = original.direction === "IN" ? "OUT" : "IN";
    type = original.type;
  }

  const rawService = body?.service && typeof body.service === "object" ? body.service : {};
  const serviceAction = ["NONE", "LINK", "CREATE"].includes(rawService.action) ? rawService.action : "NONE";
  const frequency = FREQUENCIES.includes(rawService.frequency) ? rawService.frequency : undefined;
  const nextRenewal = rawService.nextRenewal ? new Date(rawService.nextRenewal) : undefined;
  if (serviceAction === "CREATE" && (!rawService.name?.trim() || !rawService.category?.trim() || !frequency || !nextRenewal || Number.isNaN(nextRenewal.getTime()))) {
    return NextResponse.json({ error: "Complete the service name, category, billing frequency and next renewal" }, { status: 400 });
  }
  if (serviceAction === "LINK" && !rawService.id) return NextResponse.json({ error: "Choose a service" }, { status: 400 });
  if (mode === "RENEWAL" && serviceAction !== "LINK") return NextResponse.json({ error: "A renewal must link an existing service" }, { status: 400 });

  const rawCredentials: unknown[] = Array.isArray(body?.credentials) ? body.credentials : [];
  const credentials = rawCredentials.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      platform: typeof item.platform === "string" ? item.platform.trim() : undefined,
      label: typeof item.label === "string" ? item.label.trim() : "",
      value: typeof item.value === "string" ? item.value : "",
      expiresAt: item.expiresAt ? new Date(String(item.expiresAt)) : null,
    };
  }).filter((entry) => entry.label && entry.value);
  if (credentials.length > 10 || credentials.some((item) => item.expiresAt && Number.isNaN(item.expiresAt.getTime()))) {
    return NextResponse.json({ error: "Enter at most 10 credentials with valid expiry dates" }, { status: 400 });
  }

  const status = mode === "RENEWAL" ? "PENDING" : "APPROVED";
  try {
    const result = await recordFinancialEvent({
      actorId: user.id,
      amount,
      currency,
      method,
      direction,
      type,
      description,
      date,
      status,
      fromUserId: direction === "IN" && mode !== "REVERSAL" ? body?.fromUserId || null : null,
      reversalOfId,
      attachments,
      service: {
        action: serviceAction,
        id: typeof rawService.id === "string" ? rawService.id : undefined,
        name: typeof rawService.name === "string" ? rawService.name.trim() : undefined,
        category: typeof rawService.category === "string" ? rawService.category.trim() : undefined,
        frequency,
        nextRenewal,
        planUrl: typeof rawService.planUrl === "string" ? rawService.planUrl.trim() : undefined,
        templateId: typeof rawService.templateId === "string" ? rawService.templateId : undefined,
        metadata: rawService.metadata && typeof rawService.metadata === "object" ? rawService.metadata : undefined,
        autoRenew: rawService.autoRenew === true,
      },
      credentials,
      advancesServiceCycle: mode === "RENEWAL",
    });

    await logAudit({
      userId: user.id,
      action: "FINANCIAL_EVENT_RECORDED",
      entityType: result.service ? "Service" : "Transaction",
      entityId: result.service?.id || result.transaction.id,
      transactionId: result.transaction.id,
      workflowId: result.workflowId,
      after: {
        mode,
        description,
        transactionId: result.transaction.id,
        serviceId: result.service?.id,
        reminderId: result.reminder?.id,
        credentialIds: result.credentials.map((credential) => credential.id),
        documentCount: attachments.length,
      },
      userName: user.name,
      details: `${mode}: ${description}`,
      request: req,
    });
    const documents = attachments.length ? await prisma.document.findMany({ where: { url: { in: attachments } }, select: { id: true, originalName: true, kind: true } }) : [];
    await Promise.all([
      logAudit({ userId: user.id, action: "TRANSACTION_CREATED", entityType: "Transaction", entityId: result.transaction.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { amount, currency, direction, type, status } }),
      ...(result.service ? [logAudit({ userId: user.id, action: "SERVICE_CREATED", entityType: "Service", entityId: result.service.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { name: result.service.name, category: result.service.category } })] : []),
      ...(result.reminder ? [logAudit({ userId: user.id, action: "REMINDER_CREATED", entityType: "Reminder", entityId: result.reminder.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { message: result.reminder.message, nextFire: result.reminder.nextFire } })] : []),
      ...result.credentials.map((credential) => logAudit({ userId: user.id, action: "CREDENTIAL_CREATED", entityType: "Credential", entityId: credential.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { platform: credential.platform, label: credential.label, expiresAt: credential.expiresAt } })),
      ...documents.map((document) => logAudit({ userId: user.id, action: "DOCUMENT_LINKED", entityType: "Document", entityId: document.id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { name: document.originalName, kind: document.kind } })),
    ]);

    const identity = result.transaction.fromUser || result.transaction.createdBy;
    logTelegramTransaction({
      id: result.transaction.id,
      amount: result.transaction.amount,
      currency: result.transaction.currency,
      method: result.transaction.method,
      direction: result.transaction.direction,
      type: result.transaction.type,
      description: result.transaction.description,
      status: result.transaction.status,
      identityName: identity.name,
      identityTelegramUser: identity.telegramUser,
      identityTelegramId: identity.telegramId,
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
      details: `${mode}: ${description}`,
    });

    const attachmentArchive = attachments.length
      ? await archiveTransactionAttachmentsToTelegram(result.transaction)
      : [];
    scheduleFinanceAutomation({ action: "CREATED", actorName: user.name, transactionId: result.transaction.id, sendBackup: true });

    if (status === "PENDING") {
      await notifyAdmins({
        type: "TX_PENDING",
        title: "Renewal needs approval",
        message: `${description} · ${currency} ${amount}. Approve it before the billing cycle advances.`,
        entityId: result.transaction.id,
        priority: "HIGH",
        actionUrl: `/admin/transactions?status=PENDING&transactionId=${encodeURIComponent(result.transaction.id)}`,
        telegramMessage: formatTgMessage("Renewal needs approval", `${currency} ${amount}`, description),
      });
    }

    return NextResponse.json({ ...result, attachmentArchive }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record transaction" }, { status: 400 });
  }
}
