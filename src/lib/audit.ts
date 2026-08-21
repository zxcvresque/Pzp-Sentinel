import { prisma } from "./db";
import { logAuditEvent } from "./telegram-log";
import { randomUUID } from "node:crypto";

export function auditRequestContext(request?: Request) {
  if (!request) return { requestId: randomUUID() };
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: request.headers.get("cf-connecting-ip") || forwarded || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
    requestId: request.headers.get("x-request-id") || request.headers.get("cf-ray") || randomUUID(),
  };
}

export async function logAudit(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  transactionId?: string;
  workflowId?: string;
  before?: unknown;
  after?: unknown;
  userName?: string;
  details?: string;
  request?: Request;
  outcome?: "SUCCESS" | "FAILURE";
  errorMessage?: string;
}) {
  const context = auditRequestContext(params.request);
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      transactionId: params.transactionId,
      workflowId: params.workflowId,
      before: params.before ? JSON.parse(JSON.stringify(params.before)) : undefined,
      after: params.after ? JSON.parse(JSON.stringify(params.after)) : undefined,
      ...context,
      outcome: params.outcome ?? "SUCCESS",
      errorMessage: params.errorMessage,
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
