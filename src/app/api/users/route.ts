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

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, roles, status, name, telegramUser } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (roles !== undefined) data.roles = roles;
  if (status !== undefined) data.status = status;
  if (name !== undefined) data.name = name;
  if (telegramUser !== undefined) data.telegramUser = telegramUser;

  const updated = await prisma.user.update({
    where: { id },
    data,
  });

  const changes: string[] = [];
  if (roles !== undefined) changes.push(`roles: ${target.roles.join(",")||"none"} → ${updated.roles.join(",")||"none"}`);
  if (status !== undefined) changes.push(`status: ${target.status} → ${updated.status}`);
  if (name !== undefined && name !== target.name) changes.push(`name: ${target.name} → ${updated.name}`);
  if (telegramUser !== undefined && telegramUser !== target.telegramUser) changes.push(`tg: @${target.telegramUser} → @${updated.telegramUser}`);

  await logAudit({
    userId: user.id,
    action: "UPDATE_USER",
    entityType: "User",
    entityId: id,
    before: { roles: target.roles, status: target.status, name: target.name, telegramUser: target.telegramUser },
    after: { roles: updated.roles, status: updated.status, name: updated.name, telegramUser: updated.telegramUser },
    userName: user.name,
    details: `${target.name}: ${changes.join("; ")}`,
  });

  return NextResponse.json({ user: updated });
}
