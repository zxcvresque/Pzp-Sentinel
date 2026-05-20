import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { bot } from "@/lib/bot";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { fromUser: true },
  });

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  if (transaction.status !== "PENDING") {
    return NextResponse.json({ error: "Transaction is not pending" }, { status: 400 });
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: { status: "APPROVED", reviewedById: user.id },
    include: { fromUser: true },
  });

  await logAudit({
    userId: user.id,
    action: "APPROVE",
    entityType: "Transaction",
    entityId: id,
    transactionId: id,
    before: { status: "PENDING" },
    after: { status: "APPROVED" },
  });

  if (updated.fromUser?.chatId) {
    try {
      await bot.api.sendMessage(
        updated.fromUser.chatId,
        `✅ Your donation of ${updated.currency} ${updated.amount} has been approved!`
      );
    } catch {
      // notification failed — donor will see status in-app
    }
  }

  return NextResponse.json({ transaction: updated });
}
