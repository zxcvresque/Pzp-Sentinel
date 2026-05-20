import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const reminders = await prisma.reminder.findMany({
    orderBy: { nextFire: "asc" },
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { message, frequency, nextFire, channel, recipientRoles } = body;

  if (!message || !nextFire) {
    return NextResponse.json(
      { error: "Message and nextFire are required" },
      { status: 400 },
    );
  }

  const reminder = await prisma.reminder.create({
    data: {
      message,
      frequency: frequency || "ONCE",
      nextFire: new Date(nextFire),
      channel: channel || "BOTH",
      recipientRoles: recipientRoles || [],
      createdById: user.id,
    },
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({ reminder }, { status: 201 });
}
