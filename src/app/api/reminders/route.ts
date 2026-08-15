import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logReminderAction } from "@/lib/github-log";
import {
  parseReminderChannel,
  parseReminderFrequency,
  parseReminderRepeatUnit,
} from "@/lib/admin-reminders";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const reminders = await prisma.reminder.findMany({
    where: { active: true },
    orderBy: { nextFire: "asc" },
    include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } },
  });

  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const nextFire = new Date(body?.nextFire);
  const frequency = parseReminderFrequency(body?.frequency ?? "ONCE");
  const channel = parseReminderChannel(body?.channel ?? "BOTH");
  const repeatEvery = Number(body?.repeatEvery);
  const repeatUnit = parseReminderRepeatUnit(body?.repeatUnit);

  if (!message || Number.isNaN(nextFire.getTime())) {
    return NextResponse.json(
      { error: "Message and a valid first send time are required" },
      { status: 400 },
    );
  }
  if (!frequency || !channel) {
    return NextResponse.json({ error: "Invalid frequency or delivery channel" }, { status: 400 });
  }
  if (frequency === "CUSTOM" && (
    !Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 10_000 || !repeatUnit
  )) {
    return NextResponse.json(
      { error: "Custom repeats require a whole number from 1 to 10,000 and a valid unit" },
      { status: 400 },
    );
  }

  const reminder = await prisma.reminder.create({
    data: {
      message,
      frequency,
      repeatEvery: frequency === "CUSTOM" ? repeatEvery : null,
      repeatUnit: frequency === "CUSTOM" ? repeatUnit : null,
      nextFire,
      channel,
      recipientRoles: ["ADMIN"],
      createdById: user.id,
    },
    include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } },
  });

  // GitHub immutable log
  logReminderAction({
    action: "CREATED",
    userId: user.id,
    userName: user.name,
    entityId: reminder.id,
    details: `${reminder.frequency}: ${reminder.message.slice(0, 80)}`,
  });

  return NextResponse.json({ reminder }, { status: 201 });
}
