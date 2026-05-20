import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logUserCreated } from "@/lib/telegram-log";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      telegramId: true,
      telegramUser: true,
      name: true,
      roles: true,
      status: true,
      chatId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { telegramId, telegramUser, name, roles } = await req.json();

  if (!telegramId || !name) {
    return NextResponse.json({ error: "Telegram ID and name are required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return NextResponse.json({ error: "User with this Telegram ID already exists" }, { status: 409 });
  }

  const newUser = await prisma.user.create({
    data: {
      telegramId,
      telegramUser: telegramUser || "",
      name,
      roles: roles || ["DONOR"],
      createdById: user.id,
    },
  });

  await logAudit({
    userId: user.id,
    action: "CREATE",
    entityType: "User",
    entityId: newUser.id,
    after: newUser,
    userName: user.name,
  });

  logUserCreated({
    name: newUser.name,
    telegramUser: newUser.telegramUser,
    roles: newUser.roles,
    createdByName: user.name,
  });

  return NextResponse.json({ user: newUser }, { status: 201 });
}
