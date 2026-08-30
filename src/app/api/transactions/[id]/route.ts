import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logTransaction } from "@/lib/github-log";
import { Prisma } from "@/generated/prisma/client";
import { logTransactionMutation } from "@/lib/telegram-log";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { bmcAccountSlug } from "@/lib/bmc-attribution";
import { notify, formatTgMessage } from "@/lib/notifications";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { serviceReminderRepeat } from "@/lib/service-templates";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { parseBmcWebhook } from "@/lib/bmc-webhook";
import { parseDonationFrequency } from "@/lib/donation-frequency";
import { isCustomRepeatUnit, isServiceFrequency } from "@/lib/service-billing";
import { isProviderVerified } from "@/lib/provider-verification";

class TransactionEditValidationError extends Error {}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { amount, currency, direction, type, method, description, date, fromUserId, attachments, serviceId, createService, updateService, credentials, confirmReviewedEdit, donationFrequency } = body;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  const isAdmin = hasRole(user.roles, "ADMIN");
  const donorOwnsPending = hasRole(user.roles, "DONOR")
    && (transaction.fromUserId === user.id || transaction.createdById === user.id)
    && transaction.status === "PENDING"
    && !isProviderVerified(transaction)
    && !transaction.voidedAt;
  if (!isAdmin && !donorOwnsPending) return NextResponse.json({ error: "Only an admin or the owner of a pending manual submission may edit it" }, { status: 403 });
  if (!isAdmin) {
    const allowed = new Set(["amount", "currency", "method", "description", "date", "attachments", "donationFrequency"]);
    const invalid = Object.keys(body).filter((key) => !allowed.has(key));
    if (invalid.length) return NextResponse.json({ error: `Donors cannot edit: ${invalid.join(", ")}` }, { status: 400 });
  }

  // Validate amount if provided
  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
  }

  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Voided transactions cannot be edited" }, { status: 400 });
  }
  if (transaction.status !== "PENDING" && confirmReviewedEdit !== true) {
    return NextResponse.json(
      { error: "Editing a reviewed transaction requires explicit confirmation" },
      { status: 409 },
    );
  }

  if (currency !== undefined && !["INR", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (direction !== undefined && !["IN", "OUT"].includes(direction)) {
    return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  }
  if (type !== undefined && !["DONATION", "EXPENSE", "SUBSCRIPTION", "OTHER"].includes(type)) {
    return NextResponse.json({ error: "Invalid transaction type" }, { status: 400 });
  }
  if (method !== undefined && !["UPI", "RAZORPAY", "BMC", "BANK", "OTHER"].includes(method)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }
  if (method !== undefined && method === "RAZORPAY" && !isProviderVerified(transaction)) {
    return NextResponse.json({ error: "Provider methods can only come from a verified provider payment" }, { status: 400 });
  }
  if (description !== undefined && (typeof description !== "string" || !description.trim())) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }
  if (date !== undefined && Number.isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: "Invalid transaction date" }, { status: 400 });
  }
  if (attachments !== undefined && (
    !Array.isArray(attachments)
    || attachments.length > 10
    || attachments.some((item) => typeof item !== "string" || !item.trim())
  )) {
    return NextResponse.json({ error: "Attachments must contain at most 10 valid references" }, { status: 400 });
  }
  if (fromUserId !== undefined && fromUserId !== null && typeof fromUserId !== "string") {
    return NextResponse.json({ error: "Invalid donor/source user" }, { status: 400 });
  }
  if (serviceId !== undefined && serviceId !== null) {
    if (typeof serviceId !== "string" || !await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } })) {
      return NextResponse.json({ error: "Linked service not found" }, { status: 400 });
    }
  }
  if (typeof fromUserId === "string" && fromUserId) {
    const sourceUser = await prisma.user.findFirst({
      where: { id: fromUserId, roles: { has: "DONOR" }, status: "ACTIVE" },
      select: { id: true },
    });
    if (!sourceUser) return NextResponse.json({ error: "Donor/source user not found" }, { status: 400 });
  }

  const isBmcReconciliation = transaction.method === "BMC"
    && !transaction.fromUserId
    && typeof fromUserId === "string"
    && Boolean(fromUserId);
  const bmcReceipt = isBmcReconciliation
    ? await prisma.bmcWebhookEvent.findFirst({
        where: { transactionId: transaction.id },
        select: { id: true, supporterId: true, supporterEmail: true, encryptedPayload: true },
      })
    : null;
  if (bmcReceipt?.supporterId) {
    const existingLink = await prisma.bmcSupporterLink.findUnique({
      where: {
        accountSlug_supporterId: {
          accountSlug: bmcAccountSlug(),
          supporterId: bmcReceipt.supporterId,
        },
      },
    });
    if (existingLink && existingLink.userId !== fromUserId) {
      return NextResponse.json({
        error: "This BMC supporter is already linked to another donor. Review the existing link before reassigning it.",
      }, { status: 409 });
    }
  }

  const data: Prisma.TransactionUpdateInput = {};
  if (amount !== undefined) data.amount = new Prisma.Decimal(amount);
  if (currency !== undefined) data.currency = currency;
  if (direction !== undefined) data.direction = direction;
  if (type !== undefined) data.type = type;
  if (method !== undefined) data.method = method;
  if (description !== undefined) data.description = description.trim();
  if (date !== undefined) data.date = new Date(date);
  if (donationFrequency !== undefined) data.donationFrequency = parseDonationFrequency(donationFrequency);
  if (attachments !== undefined) {
    data.attachments = attachments.map((item: string) => item.trim());
  }
  const effectiveDirection = direction ?? transaction.direction;
  const effectiveType = type ?? transaction.type;
  if (credentials !== undefined) {
    if (!Array.isArray(credentials) || credentials.length > 10) {
      return NextResponse.json({ error: "Enter at most 10 credentials for a linked service" }, { status: 400 });
    }
    for (const rawCredential of credentials as Array<Record<string, unknown>>) {
      const credentialId = typeof rawCredential.id === "string" ? rawCredential.id : "";
      const label = typeof rawCredential.label === "string" ? rawCredential.label.trim() : "";
      const value = typeof rawCredential.value === "string" ? rawCredential.value : "";
      const expiresAt = rawCredential.expiresAt ? new Date(String(rawCredential.expiresAt)) : null;
      if (!label || (expiresAt && Number.isNaN(expiresAt.getTime())) || (!credentialId && !value)) {
        return NextResponse.json({ error: "Each new credential needs a label and secret; expiry dates must be valid" }, { status: 400 });
      }
    }
    if (!createService) {
      const existingTargetId = typeof serviceId === "string" && serviceId ? serviceId : transaction.serviceId;
      const credentialIds = credentials.map((item: Record<string, unknown>) => typeof item.id === "string" ? item.id : "").filter(Boolean);
      if (!existingTargetId || (credentialIds.length && await prisma.credential.count({ where: { id: { in: credentialIds }, serviceId: existingTargetId, parentId: null, deletedAt: null } }) !== new Set(credentialIds).size)) {
        return NextResponse.json({ error: "A linked credential could not be found" }, { status: 400 });
      }
    }
  }
  let atomicResult;
  try {
    atomicResult = await prisma.$transaction(async (tx) => {
  let createdServiceId: string | null = null;
  if (createService) {
    const serviceName = typeof createService.name === "string" ? createService.name.trim() : "";
    const serviceCategory = typeof createService.category === "string" ? createService.category.trim() : "";
    const serviceFrequency = isServiceFrequency(createService.frequency) ? createService.frequency : null;
    const customRepeatEvery = serviceFrequency === "CUSTOM" ? Number(createService.customRepeatEvery) : null;
    const customRepeatUnit = serviceFrequency === "CUSTOM" && isCustomRepeatUnit(createService.customRepeatUnit) ? createService.customRepeatUnit : null;
    const renewalAt = createService.nextRenewal ? new Date(createService.nextRenewal) : null;
    if (effectiveDirection !== "OUT" || effectiveType !== "SUBSCRIPTION" || !serviceName || !serviceCategory || !serviceFrequency || (serviceFrequency === "CUSTOM" && (!Number.isInteger(customRepeatEvery) || Number(customRepeatEvery) <= 0 || !customRepeatUnit)) || !renewalAt || Number.isNaN(renewalAt.getTime())) {
      throw new TransactionEditValidationError("Creating a service requires an outgoing subscription, name, category, billing frequency and next renewal");
    }
    const service = await tx.service.create({
      data: {
        name: serviceName,
        category: serviceCategory,
        price: amount !== undefined ? new Prisma.Decimal(amount) : transaction.amount,
        currency: currency ?? transaction.currency,
        frequency: serviceFrequency,
        customRepeatEvery,
        customRepeatUnit,
        planUrl: typeof createService.planUrl === "string" ? createService.planUrl.trim() || null : null,
        autoRenew: createService.autoRenew === true,
        columns: Array.isArray(createService.columns) && createService.columns.length ? createService.columns : undefined,
        entries: Array.isArray(createService.entries) && createService.entries.length ? createService.entries : undefined,
        expiryDate: renewalAt,
        lastRenewalDate: date ? new Date(date) : transaction.date,
        status: "ACTIVE",
        paidTxId: id,
        attachments: attachments ?? transaction.attachments,
      },
    });
    createdServiceId = service.id;
    const repeat = serviceReminderRepeat(serviceFrequency, customRepeatEvery, customRepeatUnit);
    if (repeat) {
      await tx.reminder.create({
        data: {
          createdById: user.id,
          message: `Renew ${serviceName} (${service.currency} ${service.price})`,
          frequency: "CUSTOM",
          repeatEvery: repeat.repeatEvery,
          repeatUnit: repeat.repeatUnit,
          nextFire: renewalAt,
          channel: "BOTH",
          recipientRoles: ["ADMIN"],
          serviceId: service.id,
        },
      });
    }
  }

  let serviceBeforeForAudit: Record<string, unknown> | null = null;
  let serviceAfterForAudit: Record<string, unknown> | null = null;
  const credentialAuditRows: Array<{ id: string; action: "CREDENTIAL_CREATE" | "CREDENTIAL_UPDATE"; before?: Record<string, unknown>; after: Record<string, unknown> }> = [];
  const targetServiceId = createdServiceId || (typeof serviceId === "string" && serviceId ? serviceId : transaction.serviceId);
  if (updateService) {
    if (effectiveDirection !== "OUT" || effectiveType !== "SUBSCRIPTION" || !targetServiceId) {
      throw new TransactionEditValidationError("Service details can only be edited for a linked outgoing subscription");
    }
    const existingService = await tx.service.findUnique({ where: { id: targetServiceId } });
    if (!existingService) throw new TransactionEditValidationError("Linked service not found");
    const serviceName = typeof updateService.name === "string" ? updateService.name.trim() : "";
    const serviceCategory = typeof updateService.category === "string" ? updateService.category.trim() : "";
    const serviceFrequency = isServiceFrequency(updateService.frequency) ? updateService.frequency : null;
    const customRepeatEvery = serviceFrequency === "CUSTOM" ? Number(updateService.customRepeatEvery) : null;
    const customRepeatUnit = serviceFrequency === "CUSTOM" && isCustomRepeatUnit(updateService.customRepeatUnit) ? updateService.customRepeatUnit : null;
    const renewalAt = updateService.nextRenewal ? new Date(updateService.nextRenewal) : null;
    if (!serviceName || !serviceCategory || !serviceFrequency || (serviceFrequency === "CUSTOM" && (!Number.isInteger(customRepeatEvery) || Number(customRepeatEvery) <= 0 || !customRepeatUnit)) || !renewalAt || Number.isNaN(renewalAt.getTime())) {
      throw new TransactionEditValidationError("Complete the linked service name, category, billing frequency and next renewal");
    }
    serviceBeforeForAudit = {
      name: existingService.name,
      category: existingService.category,
      frequency: existingService.frequency,
      customRepeatEvery: existingService.customRepeatEvery,
      customRepeatUnit: existingService.customRepeatUnit,
      planUrl: existingService.planUrl,
      expiryDate: existingService.expiryDate,
      autoRenew: existingService.autoRenew,
      columns: existingService.columns,
      entries: existingService.entries,
    };
    const updatedService = await tx.service.update({
      where: { id: targetServiceId },
      data: {
        name: serviceName,
        category: serviceCategory,
        price: amount !== undefined ? new Prisma.Decimal(amount) : transaction.amount,
        currency: currency ?? transaction.currency,
        frequency: serviceFrequency,
        customRepeatEvery,
        customRepeatUnit,
        planUrl: typeof updateService.planUrl === "string" ? updateService.planUrl.trim() || null : null,
        expiryDate: renewalAt,
        autoRenew: updateService.autoRenew === true,
        columns: Array.isArray(updateService.columns) && updateService.columns.length ? updateService.columns : Prisma.JsonNull,
        entries: Array.isArray(updateService.entries) && updateService.entries.length ? updateService.entries : Prisma.JsonNull,
      },
    });
    const repeat = serviceReminderRepeat(updatedService.frequency, updatedService.customRepeatEvery, updatedService.customRepeatUnit);
    const existingReminder = await tx.reminder.findFirst({ where: { serviceId: targetServiceId } });
    if (repeat) {
      const reminderData = {
        message: `Renew ${updatedService.name} (${updatedService.currency} ${updatedService.price})`,
        frequency: "CUSTOM" as const,
        repeatEvery: repeat.repeatEvery,
        repeatUnit: repeat.repeatUnit,
        nextFire: renewalAt,
        active: updatedService.status === "ACTIVE",
        recipientRoles: ["ADMIN" as const],
      };
      if (existingReminder) await tx.reminder.update({ where: { id: existingReminder.id }, data: reminderData });
      else await tx.reminder.create({ data: { ...reminderData, createdById: user.id, channel: "BOTH", serviceId: targetServiceId } });
    } else if (existingReminder?.active) {
      await tx.reminder.update({ where: { id: existingReminder.id }, data: { active: false } });
    }
    serviceAfterForAudit = {
      name: updatedService.name,
      category: updatedService.category,
      frequency: updatedService.frequency,
      customRepeatEvery: updatedService.customRepeatEvery,
      customRepeatUnit: updatedService.customRepeatUnit,
      planUrl: updatedService.planUrl,
      expiryDate: updatedService.expiryDate,
      autoRenew: updatedService.autoRenew,
      columns: updatedService.columns,
      entries: updatedService.entries,
    };
  }

  if (credentials !== undefined) {
    if (!targetServiceId || !Array.isArray(credentials) || credentials.length > 10) {
      throw new TransactionEditValidationError("Enter at most 10 credentials for a linked service");
    }
    for (const rawCredential of credentials as Array<Record<string, unknown>>) {
      const credentialId = typeof rawCredential.id === "string" ? rawCredential.id : "";
      const label = typeof rawCredential.label === "string" ? rawCredential.label.trim() : "";
      const value = typeof rawCredential.value === "string" ? rawCredential.value : "";
      const expiresAt = rawCredential.expiresAt ? new Date(String(rawCredential.expiresAt)) : null;
      if (!label || (expiresAt && Number.isNaN(expiresAt.getTime())) || (!credentialId && !value)) {
        throw new TransactionEditValidationError("Each new credential needs a label and secret; expiry dates must be valid");
      }
      if (credentialId) {
        const existingCredential = await tx.credential.findFirst({ where: { id: credentialId, serviceId: targetServiceId, parentId: null, deletedAt: null } });
        if (!existingCredential) throw new TransactionEditValidationError("A linked credential could not be found");
        const updatedCredential = await tx.credential.update({
          where: { id: credentialId },
          data: {
            label,
            expiresAt,
            ...(value ? { value: encryptSecret(value) } : {}),
          },
        });
        if (value && existingCredential.vpsServerId && existingCredential.credKind) {
          const vpsColumn = existingCredential.credKind === "VPS_PASSWORD" ? "password"
            : existingCredential.credKind === "VPS_SSH_KEY" ? "sshKeyFileUrl"
              : null;
          if (vpsColumn) {
            await tx.vpsServer.update({ where: { id: existingCredential.vpsServerId }, data: { [vpsColumn]: encryptSecret(value) } });
          }
        }
        credentialAuditRows.push({
          id: credentialId,
          action: "CREDENTIAL_UPDATE",
          before: { label: existingCredential.label, expiresAt: existingCredential.expiresAt },
          after: { label: updatedCredential.label, expiresAt: updatedCredential.expiresAt, valueChanged: Boolean(value) },
        });
      } else {
        const createdCredential = await tx.credential.create({
          data: {
            platform: typeof rawCredential.platform === "string" && rawCredential.platform.trim() ? rawCredential.platform.trim() : (typeof updateService?.name === "string" ? updateService.name.trim() : "Service"),
            label,
            value: encryptSecret(value),
            expiresAt,
            status: "APPROVED",
            createdById: user.id,
            serviceId: targetServiceId,
          },
        });
        credentialAuditRows.push({ id: createdCredential.id, action: "CREDENTIAL_CREATE", after: { label: createdCredential.label, expiresAt: createdCredential.expiresAt, serviceId: targetServiceId } });
      }
    }
  }
  if (serviceId !== undefined || effectiveDirection !== "OUT" || effectiveType !== "SUBSCRIPTION") {
    const linkId = createdServiceId || serviceId;
    data.linkedService = effectiveDirection === "OUT" && effectiveType === "SUBSCRIPTION" && linkId
      ? { connect: { id: linkId } }
      : { disconnect: true };
  }
  if (fromUserId !== undefined || effectiveDirection === "OUT") {
    const sourceId = effectiveDirection === "OUT" ? null : fromUserId;
    data.fromUser = sourceId ? { connect: { id: sourceId } } : { disconnect: true };
  }

  const before = {
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    type: transaction.type,
    method: transaction.method,
    description: transaction.description,
    date: transaction.date.toISOString(),
    fromUserId: transaction.fromUserId,
    attachments: transaction.attachments,
    serviceId: transaction.serviceId,
  };

  const updated = await tx.transaction.update({
    where: { id },
    data,
    include: { fromUser: true, createdBy: true, reviewedBy: true, voidedBy: true, linkedService: { select: { id: true, name: true } } },
  });

  if (isBmcReconciliation && updated.fromUserId) {
    if (bmcReceipt?.supporterId) {
      let supporterName: string | null = null;
      let supporterEmail = bmcReceipt.supporterEmail;
      if (bmcReceipt.encryptedPayload) {
        try {
          const normalized = parseBmcWebhook(decryptSecret(bmcReceipt.encryptedPayload));
          supporterName = normalized.supporterName;
          supporterEmail = normalized.supporterEmail;
        } catch {
          // Historical malformed payload: retain only the legacy email below.
        }
      }
      const supporterDetailsEncrypted = encryptSecret(JSON.stringify({ supporterName, supporterEmail }));
      await tx.bmcSupporterLink.upsert({
        where: {
          accountSlug_supporterId: {
            accountSlug: bmcAccountSlug(),
            supporterId: bmcReceipt.supporterId,
          },
        },
        update: {
          supporterEmail: null,
          supporterDetailsEncrypted,
          lastSeenAt: new Date(),
          donationFrequency: updated.donationFrequency,
        },
        create: {
          accountSlug: bmcAccountSlug(),
          supporterId: bmcReceipt.supporterId,
          supporterEmail: null,
          supporterDetailsEncrypted,
          userId: updated.fromUserId,
          donationFrequency: updated.donationFrequency,
        },
      });
    }
    if (bmcReceipt) {
      await tx.bmcWebhookEvent.update({
        where: { id: bmcReceipt.id },
        data: { attributionStatus: "ADMIN_RECONCILED" },
      });
    }
  }

  return { updated, before, serviceBeforeForAudit, serviceAfterForAudit, credentialAuditRows, targetServiceId };
    });
  } catch (error) {
    if (error instanceof TransactionEditValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const { updated, before, serviceBeforeForAudit, serviceAfterForAudit, credentialAuditRows, targetServiceId } = atomicResult;

  if (serviceBeforeForAudit && serviceAfterForAudit && targetServiceId) {
    await logAudit({ userId: user.id, action: "SERVICE_UPDATE", entityType: "Service", entityId: targetServiceId, transactionId: id, before: serviceBeforeForAudit, after: serviceAfterForAudit, userName: user.name, request: req });
  }
  await Promise.all(credentialAuditRows.map((row) => logAudit({ userId: user.id, action: row.action, entityType: "Credential", entityId: row.id, transactionId: id, before: row.before, after: row.after, userName: user.name, request: req })));

  if (isBmcReconciliation && updated.fromUserId) {
    if (updated.fromUser) {
      const symbol = updated.currency === "INR" ? "₹" : "$";
      await notify({
        userId: updated.fromUser.id,
        type: "TX_APPROVED",
        title: "BMC donation linked to your account",
        message: `${symbol}${updated.amount} from Buy Me a Coffee was added to your donation history.`,
        entityId: updated.id,
        actionUrl: "/donor",
        telegramMessage: formatTgMessage(
          "BMC Donation Linked",
          `${symbol}${updated.amount} added to your Sentinel history`,
        ),
      });
    }
  }
  const identityUser = updated.fromUser || updated.createdBy;

  const after = {
    amount: updated.amount.toString(),
    currency: updated.currency,
    direction: updated.direction,
    type: updated.type,
    method: updated.method,
    description: updated.description,
    date: updated.date.toISOString(),
    fromUserId: updated.fromUserId,
    attachments: updated.attachments,
    serviceId: updated.serviceId,
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
    request: req,
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

  const changes = Object.keys(after)
    .filter((key) => before[key as keyof typeof before] !== after[key as keyof typeof after])
    .map((key) => `${key}: ${before[key as keyof typeof before]} → ${after[key as keyof typeof after]}`);
  logTransactionMutation({
    action: "UPDATED",
    id,
    actorName: user.name,
    amount: updated.amount,
    currency: updated.currency,
    direction: updated.direction,
    description: updated.description,
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    changes,
  });
  scheduleFinanceAutomation({ action: "UPDATED", actorName: user.name, transactionId: id });

  // Archive new files and retry any prior Telegram archive failures. Existing
  // successful copies are skipped using their persisted Telegram file ID.
  const attachmentArchive = updated.attachments.length > 0
    ? await archiveTransactionAttachmentsToTelegram({
        id: updated.id,
        amount: updated.amount,
        currency: updated.currency,
        description: updated.description,
        attachments: updated.attachments,
      })
    : [];

  return NextResponse.json({ transaction: updated, attachmentArchive });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!reason && isAdmin) {
    return NextResponse.json({ error: "A void reason is required" }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: "Void reason must be at most 500 characters" }, { status: 400 });
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { fromUser: true, createdBy: true },
  });
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (transaction.voidedAt) {
    return NextResponse.json({ error: "Transaction is already voided" }, { status: 400 });
  }
  const donorCanCancel = hasRole(user.roles, "DONOR")
    && (transaction.fromUserId === user.id || transaction.createdById === user.id)
    && transaction.status === "PENDING"
    && !isProviderVerified(transaction);
  if (!isAdmin && !donorCanCancel) return NextResponse.json({ error: "Only your pending manual submission can be cancelled" }, { status: 403 });
  const effectiveReason = reason || "Cancelled by donor";
  const identityUser = transaction.fromUser || transaction.createdBy;

  const voided = await prisma.transaction.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: user.id, voidReason: effectiveReason },
    include: { fromUser: true, createdBy: true, reviewedBy: true, voidedBy: true },
  });

  await logAudit({
    userId: user.id,
    action: "VOID",
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
    after: { voidedAt: voided.voidedAt, voidedById: user.id, voidReason: effectiveReason },
    userName: user.name,
    details: `"Voided Txn:"
${transaction.direction} ${transaction.currency} ${transaction.amount} — ${transaction.description}
"Reason:"
${effectiveReason}`,
    request: req,
  });

  // GitHub immutable log
  logTransaction({
    action: "VOIDED",
    userId: user.id,
    userName: user.name,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    direction: transaction.direction,
    method: transaction.method,
    entityId: id,
    details: `Voided: ${transaction.description} — Reason: ${effectiveReason}`,
  });

  logTransactionMutation({
    action: "VOIDED",
    id,
    actorName: user.name,
    amount: transaction.amount,
    currency: transaction.currency,
    direction: transaction.direction,
    description: transaction.description,
    identityName: identityUser.name,
    identityTelegramUser: identityUser.telegramUser,
    identityTelegramId: identityUser.telegramId,
    changes: [`reason: ${effectiveReason}`],
  });
  scheduleFinanceAutomation({ action: "DELETED", actorName: user.name, transactionId: id });

  return NextResponse.json({ transaction: voided });
}
