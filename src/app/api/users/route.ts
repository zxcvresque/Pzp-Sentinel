import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logUserCreated } from "@/lib/telegram-log";
import { logUserAction } from "@/lib/github-log";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";

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

  // GitHub immutable log
  logUserAction({
    action: "CREATED",
    adminId: user.id,
    adminName: user.name,
    targetUserId: newUser.id,
    targetUserName: newUser.name,
    details: `roles: ${newUser.roles.join(",")}, tg: @${newUser.telegramUser}`,
  });

  // Notify all admins about new user registration
  notifyAdmins({
    type: "USER_REGISTERED",
    title: "New User Registered",
    message: `${newUser.name} (@${newUser.telegramUser}) has been registered with roles: ${newUser.roles.join(", ")}. Added by ${user.name}.`,
    priority: "HIGH",
    telegramMessage: formatTgMessage(
      "🆕 New User Registered",
      `${newUser.name} (@${newUser.telegramUser})`,
      `Roles: ${newUser.roles.join(", ")} -- Added by ${user.name}`,
    ),
  }).catch(() => {});

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

  // GitHub immutable log
  logUserAction({
    action: "UPDATED",
    adminId: user.id,
    adminName: user.name,
    targetUserId: id,
    targetUserName: target.name,
    details: changes.join("; "),
  });

  // Notify the target user if their roles changed
  if (roles !== undefined && JSON.stringify(target.roles) !== JSON.stringify(updated.roles)) {
    notify({
      userId: id,
      type: "ROLE_ASSIGNED",
      title: "Role Updated",
      message: `Your roles have been updated to ${updated.roles.join(", ")}. Changed by ${user.name}.`,
      priority: "HIGH",
      telegramMessage: formatTgMessage(
        "🛡️ Role Updated",
        `Your roles have been updated to ${updated.roles.join(", ")}`,
        `Changed by ${user.name}`,
      ),
    }).catch(() => {});
  }

  return NextResponse.json({ user: updated });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  if (id === user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.status === "ACTIVE") {
    return NextResponse.json({ error: "Deactivate the user before deleting" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });

  await logAudit({
    userId: user.id,
    action: "DELETE_USER",
    entityType: "User",
    entityId: id,
    before: { name: target.name, telegramId: target.telegramId, roles: target.roles },
    userName: user.name,
    details: `Permanently deleted ${target.name} (@${target.telegramUser})`,
  });

  logUserAction({
    action: "DELETED",
    adminId: user.id,
    adminName: user.name,
    targetUserId: id,
    targetUserName: target.name,
    details: `Permanently removed. Was: roles=${target.roles.join(",") || "none"}, tg=@${target.telegramUser}`,
  });

  return NextResponse.json({ success: true });
}
