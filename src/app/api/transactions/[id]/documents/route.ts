import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { archiveTransactionAttachmentsToTelegram } from "@/lib/attachment-archive";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.attachments)
    ? body.attachments.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (!incoming.length) return NextResponse.json({ error: "Upload at least one receipt or document" }, { status: 400 });

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  const attachments = [...new Set([...existing.attachments, ...incoming])];
  if (attachments.length > 10) return NextResponse.json({ error: "A transaction can contain at most 10 documents" }, { status: 400 });

  const transaction = await prisma.$transaction(async (db) => {
    const updated = await db.transaction.update({ where: { id }, data: { attachments } });
    await db.document.updateMany({
      where: { url: { in: incoming }, uploaderId: user.id },
      data: { status: "LINKED", transactionId: id, serviceId: existing.serviceId, workflowId: existing.workflowId },
    });
    return updated;
  });
  const attachmentArchive = await archiveTransactionAttachmentsToTelegram(transaction);
  await logAudit({
    userId: user.id,
    action: "TRANSACTION_DOCUMENTS_ADDED",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    workflowId: existing.workflowId || undefined,
    before: { attachments: existing.attachments },
    after: { attachments },
    userName: user.name,
    request: req,
  });
  return NextResponse.json({ transaction, attachmentArchive });
}
