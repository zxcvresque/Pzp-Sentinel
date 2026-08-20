import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "DONOR")) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 1000) return NextResponse.json({ error: "Appeal must be between 1 and 1000 characters" }, { status: 400 });

  const transaction = await prisma.transaction.findFirst({
    where: { id, status: "REJECTED", voidedAt: null, OR: [{ fromUserId: user.id }, { createdById: user.id }] },
  });
  if (!transaction) return NextResponse.json({ error: "Rejected donation not found" }, { status: 404 });

  const updated = await prisma.transaction.update({
    where: { id },
    data: { donorAppealMessage: message, donorAppealedAt: new Date() },
  });
  await logAudit({ userId: user.id, userName: user.name, action: "TX_APPEAL", entityType: "Transaction", entityId: id, transactionId: id, after: { message }, request: req });
  await notifyAdmins({
    type: "TX_PENDING",
    title: "Donation appeal received",
    message: `${user.name} appealed a rejected contribution: ${message}`,
    entityId: id,
    priority: "HIGH",
    actionUrl: "/admin/transactions",
    telegramMessage: formatTgMessage("Donation Appeal", `${user.name}: ${message}`, `Transaction ${id}`),
  });
  return NextResponse.json({ transaction: updated });
}
