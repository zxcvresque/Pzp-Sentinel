import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logReminderAction } from "@/lib/github-log";
import {
  parseReminderChannel,
  parseReminderFrequency,
  parseReminderRepeatUnit,
} from "@/lib/admin-reminders";
import { logAudit } from "@/lib/audit";

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

  const body = await req.json().catch(() => null);
  if (body?.action === "ACKNOWLEDGE") {
    const reminder = await prisma.reminder.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedById: user.id } });
    await logAudit({ userId: user.id, action: "REMINDER_ACKNOWLEDGE", entityType: "Reminder", entityId: id, before: existing, after: reminder, userName: user.name, request: req });
    return NextResponse.json({ reminder });
  }
  if (body?.action === "SNOOZE") {
    const until = new Date(body.until);
    if (Number.isNaN(until.getTime()) || until <= new Date()) return NextResponse.json({ error: "Choose a future snooze time" }, { status: 400 });
    const reminder = await prisma.reminder.update({ where: { id }, data: { snoozedUntil: until, nextFire: until, acknowledgedAt: null, acknowledgedById: null, escalatedAt: null } });
    await logAudit({ userId: user.id, action: "REMINDER_SNOOZE", entityType: "Reminder", entityId: id, before: existing, after: reminder, userName: user.name, request: req });
    return NextResponse.json({ reminder });
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const nextFire = new Date(body?.nextFire);
  const frequency = parseReminderFrequency(body?.frequency ?? "ONCE");
  const channel = parseReminderChannel(body?.channel ?? "BOTH");
  const repeatEvery = Number(body?.repeatEvery);
  const repeatUnit = parseReminderRepeatUnit(body?.repeatUnit);
  const ownerId = typeof body?.ownerId === "string" && body.ownerId ? body.ownerId : user.id;
  const escalationAt = body?.escalationAt ? new Date(body.escalationAt) : null;

  if (!message || Number.isNaN(nextFire.getTime())) {
    return NextResponse.json(
      { error: "Message and a valid first send time are required" },
      { status: 400 },
    );
  }
  if (nextFire <= new Date()) {
    return NextResponse.json({ error: "First send must be in the future" }, { status: 400 });
  }
  if (!frequency || !channel) {
    return NextResponse.json({ error: "Invalid frequency or delivery channel" }, { status: 400 });
  }
  if (escalationAt && Number.isNaN(escalationAt.getTime())) return NextResponse.json({ error: "Invalid escalation time" }, { status: 400 });
  if (escalationAt && escalationAt <= nextFire) return NextResponse.json({ error: "Escalation must be after the first send" }, { status: 400 });
  if (!await prisma.user.findFirst({ where: { id: ownerId, roles: { has: "ADMIN" }, status: "ACTIVE" }, select: { id: true } })) return NextResponse.json({ error: "Reminder owner must be an active admin" }, { status: 400 });
  if (frequency === "CUSTOM" && (
    !Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 10_000 || !repeatUnit
  )) {
    return NextResponse.json(
      { error: "Custom repeats require a whole number from 1 to 10,000 and a valid unit" },
      { status: 400 },
    );
  }

  const reminder = await prisma.reminder.update({
    where: { id },
    data: {
      message,
      frequency,
      repeatEvery: frequency === "CUSTOM" ? repeatEvery : null,
      repeatUnit: frequency === "CUSTOM" ? repeatUnit : null,
      nextFire,
      active: true,
      channel,
      recipientRoles: ["ADMIN"],
      ownerId,
      escalationAt,
      escalatedAt: null,
      acknowledgedAt: null,
      acknowledgedById: null,
    },
    include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } },
  });

  // GitHub immutable log
  logReminderAction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    details: `Updated: ${reminder.frequency}: ${reminder.message.slice(0, 80)}`,
  });
  await logAudit({ userId: user.id, action: "REMINDER_UPDATE", entityType: "Reminder", entityId: id, before: existing, after: reminder, userName: user.name, request: req });

  return NextResponse.json({ reminder });
}

export async function DELETE(
  req: NextRequest,
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
  await logAudit({ userId: user.id, action: "REMINDER_DELETE", entityType: "Reminder", entityId: id, before: reminder, userName: user.name, request: req });

  return NextResponse.json({ success: true });
}
