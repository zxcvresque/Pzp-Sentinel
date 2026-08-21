import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";
import { serviceReminderRepeat, serviceTemplate } from "@/lib/service-templates";

type Currency = "INR" | "USD";
type Direction = "IN" | "OUT";
type TxType = "DONATION" | "EXPENSE" | "SUBSCRIPTION" | "OTHER";
type Method = "UPI" | "BANK" | "OTHER";
type Status = "PENDING" | "APPROVED" | "REJECTED";
type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY" | "ONE_TIME" | "LIFETIME";

export interface FinancialCredentialDraft {
  platform?: string;
  label: string;
  value: string;
  expiresAt?: Date | null;
}

export interface FinancialServiceDraft {
  action: "NONE" | "LINK" | "CREATE";
  id?: string;
  name?: string;
  category?: string;
  frequency?: Frequency;
  nextRenewal?: Date;
  planUrl?: string;
  templateId?: string;
  metadata?: Record<string, string>;
  autoRenew?: boolean;
  vpsServerId?: string;
}

export interface RecordFinancialEventInput {
  workflowId?: string;
  actorId: string;
  amount: number;
  currency: Currency;
  method: Method;
  direction: Direction;
  type: TxType;
  description: string;
  date: Date;
  status: Status;
  donationFrequency?: "ONE_TIME" | "MONTHLY";
  fromUserId?: string | null;
  reversalOfId?: string | null;
  attachments?: string[];
  service?: FinancialServiceDraft;
  credentials?: FinancialCredentialDraft[];
  advancesServiceCycle?: boolean;
}

export async function recordFinancialEvent(input: RecordFinancialEventInput) {
  const workflowId = input.workflowId || randomUUID();
  const attachments = [...new Set(input.attachments || [])];
  const serviceDraft = input.service || { action: "NONE" as const };

  const result = await prisma.$transaction(async (db) => {
    let service = null;
    if (serviceDraft.action === "LINK") {
      if (!serviceDraft.id) throw new Error("Choose a service to link");
      service = await db.service.findFirst({
        where: { id: serviceDraft.id, archivedAt: null },
      });
      if (!service) throw new Error("Linked service not found");
    }

    if (serviceDraft.action === "CREATE") {
      const recurring = serviceDraft.frequency === "WEEKLY" || serviceDraft.frequency === "MONTHLY" || serviceDraft.frequency === "YEARLY";
      if (!serviceDraft.name || !serviceDraft.category || !serviceDraft.frequency || (recurring && !serviceDraft.nextRenewal)) {
        throw new Error("A service needs a name, category, billing frequency and a renewal date when recurring");
      }
      const template = serviceTemplate(serviceDraft.templateId);
      service = await db.service.create({
        data: {
          name: serviceDraft.name,
          category: serviceDraft.category,
          price: new Prisma.Decimal(input.amount),
          currency: input.currency,
          frequency: serviceDraft.frequency,
          planUrl: serviceDraft.planUrl || undefined,
          expiryDate: serviceDraft.nextRenewal,
          lastRenewalDate: input.status === "APPROVED" ? input.date : undefined,
          autoRenew: serviceDraft.autoRenew ?? false,
          status: "ACTIVE",
          columns: template?.metadata ?? undefined,
          entries: serviceDraft.metadata && Object.keys(serviceDraft.metadata).length
            ? [serviceDraft.metadata]
            : undefined,
          attachments,
          workflowId,
          vpsServerId: serviceDraft.vpsServerId,
        },
      });
    }

    const transaction = await db.transaction.create({
      data: {
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        method: input.method,
        direction: input.direction,
        type: input.type,
        donationFrequency: input.donationFrequency || "ONE_TIME",
        description: input.description,
        date: input.date,
        status: input.status,
        fromUserId: input.direction === "IN" ? input.fromUserId || null : null,
        reversalOfId: input.reversalOfId || null,
        attachments,
        providerVerified: false,
        providerState: "MANUAL",
        createdById: input.actorId,
        serviceId: service?.id || null,
        workflowId,
        advancesServiceCycle: input.advancesServiceCycle ?? false,
      },
      include: {
        fromUser: true,
        createdBy: true,
        linkedService: { select: { id: true, name: true } },
      },
    });

    let reminder = null;
    const createdCredentials: Array<{ id: string; platform: string; label: string; expiresAt: Date | null }> = [];
    if (serviceDraft.action === "CREATE" && service) {
      await db.service.update({ where: { id: service.id }, data: { paidTxId: transaction.id } });
      const repeat = serviceReminderRepeat(service.frequency);
      if (repeat && service.expiryDate) {
        reminder = await db.reminder.create({
          data: {
            createdById: input.actorId,
            message: `Renew ${service.name} (${service.currency} ${service.price})`,
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

      for (const credential of input.credentials || []) {
        if (!credential.label.trim() || !credential.value) continue;
        const created = await db.credential.create({
          data: {
            platform: credential.platform?.trim() || service.name,
            label: credential.label.trim(),
            value: encryptSecret(credential.value),
            status: "APPROVED",
            createdById: input.actorId,
            serviceId: service.id,
            expiresAt: credential.expiresAt || null,
          },
          select: { id: true, platform: true, label: true, expiresAt: true },
        });
        createdCredentials.push(created);
      }
    }

    if (attachments.length) {
      await db.document.updateMany({
        where: { url: { in: attachments }, uploaderId: input.actorId },
        data: {
          status: "LINKED",
          transactionId: transaction.id,
          serviceId: service?.id || null,
          workflowId,
        },
      });
    }

    return { service, transaction, reminder, credentials: createdCredentials };
  });

  return { ...result, workflowId };
}
