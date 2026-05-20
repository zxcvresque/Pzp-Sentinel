import { prisma } from "./db";
import { logAuditEvent } from "./telegram-log";

export async function logAudit(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  transactionId?: string;
  before?: unknown;
  after?: unknown;
  userName?: string;
  details?: string;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      transactionId: params.transactionId,
      before: params.before ? JSON.parse(JSON.stringify(params.before)) : undefined,
      after: params.after ? JSON.parse(JSON.stringify(params.after)) : undefined,
    },
  });

  if (params.userName) {
    logAuditEvent({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      userName: params.userName,
      details: params.details,
    });
  }
}
