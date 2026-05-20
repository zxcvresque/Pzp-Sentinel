import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logReminderAction } from "@/lib/github-log";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const body = await req.json();
  const { message, frequency, nextFire, channel, recipientRoles } = body;

  if (!message || !nextFire) {
    return NextResponse.json(
      { error: "Message and nextFire are required" },
      { status: 400 },
    );
  }

  const reminder = await prisma.reminder.update({
    where: { id },
    data: {
      message,
      frequency: frequency || "ONCE",
      nextFire: new Date(nextFire),
      channel: channel || "BOTH",
      recipientRoles: recipientRoles || [],
    },
    include: { createdBy: { select: { name: true } } },
  });

  // GitHub immutable log
  logReminderAction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    details: `Updated: ${reminder.frequency}: ${reminder.message.slice(0, 80)}`,
  });

  return NextResponse.json({ reminder });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const reminder = await prisma.reminder.findUnique({ where: { id } });
  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  await prisma.reminder.delete({ where: { id } });

  // GitHub immutable log
  logReminderAction({
    action: "DELETED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    details: `Deleted: ${reminder.message.slice(0, 80)}`,
  });

  return NextResponse.json({ success: true });
}
