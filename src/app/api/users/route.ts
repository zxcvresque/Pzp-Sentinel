import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logUserCreated } from "@/lib/telegram-log";
import { logUserAction } from "@/lib/github-log";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { isImmutableAdmin } from "@/lib/protected-admins";
import { isTelegramId, normalizeTelegramUsername, trimmedString, USER_ROLES, USER_STATUSES } from "@/lib/validation";

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
      photoUrl: true,
      roles: true,
      status: true,
      chatId: true,
      githubUsername: true,
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

  const { telegramId, telegramUser, name, roles, githubUsername } = await req.json();
  const cleanName = trimmedString(name, { min: 1, max: 100 });
  const cleanTelegramUser = normalizeTelegramUsername(telegramUser);

  if (!isTelegramId(telegramId) || !cleanName) {
    return NextResponse.json({ error: "Telegram ID must be 5–20 digits and name is required" }, { status: 400 });
  }
  if (cleanTelegramUser === null) {
    return NextResponse.json({ error: "Telegram username must be 5–32 letters, numbers, or underscores" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return NextResponse.json({ error: "User with this Telegram ID already exists" }, { status: 409 });
  }

  const requestedRoles = Array.isArray(roles) ? roles : ["DONOR"];
  if (!requestedRoles.length || requestedRoles.some((role) => !USER_ROLES.includes(role))) {
    return NextResponse.json({ error: "Select one or more valid roles" }, { status: 400 });
  }
  if (requestedRoles.includes("ADMIN") && !isImmutableAdmin(telegramId)) {
    return NextResponse.json({ error: "Administrator IDs are code-managed and cannot be granted through Sentinel" }, { status: 403 });
  }
  const newUser = await prisma.user.create({
    data: {
      telegramId,
      telegramUser: cleanTelegramUser,
      name: cleanName,
      roles: [...new Set(requestedRoles)],
      githubUsername: typeof githubUsername === "string" ? githubUsername.trim().replace(/^@/, "") || null : null,
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
    request: req,
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
    actionUrl: "/admin/users",
    telegramMessage: formatTgMessage(
      "🆕 New User Registered",
      `${newUser.name} (@${newUser.telegramUser})`,
      `Roles: ${newUser.roles.join(", ")} · Added by ${user.name}`,
    ),
  }).catch((err) => console.error("[users] notifyAdmins failed:", err));

  return NextResponse.json({ user: newUser }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, roles, status, name, telegramUser, githubUsername } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (roles !== undefined && (!Array.isArray(roles) || roles.some((role) => !USER_ROLES.includes(role)))) {
    return NextResponse.json({ error: "Invalid user role" }, { status: 400 });
  }
  if (status !== undefined && !USER_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid user status" }, { status: 400 });
  }
  const cleanName = name === undefined ? undefined : trimmedString(name, { min: 1, max: 100 });
  if (name !== undefined && !cleanName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const cleanTelegramUser = telegramUser === undefined ? undefined : normalizeTelegramUsername(telegramUser);
  if (telegramUser !== undefined && cleanTelegramUser === null) return NextResponse.json({ error: "Invalid Telegram username" }, { status: 400 });

  if (target.roles.includes("ADMIN")) {
    const removesAdmin = roles !== undefined && (!Array.isArray(roles) || !roles.includes("ADMIN"));
    const disablesAdmin = status !== undefined && status !== "ACTIVE";
    if (removesAdmin || disablesAdmin) {
      return NextResponse.json({ error: "Administrators cannot be demoted or deactivated through Sentinel" }, { status: 403 });
    }
  }
  if (roles !== undefined && Array.isArray(roles) && roles.includes("ADMIN") && !target.roles.includes("ADMIN") && !isImmutableAdmin(target.telegramId)) {
    return NextResponse.json({ error: "Administrator IDs are code-managed and require a deployment" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (roles !== undefined) data.roles = [...new Set(roles)];
  if (status !== undefined) data.status = status;
  if (cleanName !== undefined) data.name = cleanName;
  if (cleanTelegramUser !== undefined) data.telegramUser = cleanTelegramUser;
  if (githubUsername !== undefined) {
    const normalized = typeof githubUsername === "string" ? githubUsername.trim().replace(/^@/, "") : "";
    if (normalized && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(normalized)) {
      return NextResponse.json({ error: "Invalid GitHub username" }, { status: 400 });
    }
    data.githubUsername = normalized || null;
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
  });

  const changes: string[] = [];
  if (roles !== undefined) changes.push(`roles: ${target.roles.join(",")||"none"} → ${updated.roles.join(",")||"none"}`);
  if (status !== undefined) changes.push(`status: ${target.status} → ${updated.status}`);
  if (name !== undefined && name !== target.name) changes.push(`name: ${target.name} → ${updated.name}`);
  if (telegramUser !== undefined && telegramUser !== target.telegramUser) changes.push(`tg: @${target.telegramUser} → @${updated.telegramUser}`);
  if (githubUsername !== undefined && updated.githubUsername !== target.githubUsername) changes.push(`GitHub: @${target.githubUsername || "none"} → @${updated.githubUsername || "none"}`);

  await logAudit({
    userId: user.id,
    action: "UPDATE_USER",
    entityType: "User",
    entityId: id,
    before: { roles: target.roles, status: target.status, name: target.name, telegramUser: target.telegramUser, githubUsername: target.githubUsername },
    after: { roles: updated.roles, status: updated.status, name: updated.name, telegramUser: updated.telegramUser, githubUsername: updated.githubUsername },
    userName: user.name,
    details: `${target.name}: ${changes.join("; ")}`,
    request: req,
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
      actionUrl: "/profile",
      telegramMessage: formatTgMessage(
        "🛡️ Role Updated",
        `Your roles have been updated to ${updated.roles.join(", ")}`,
        `Changed by ${user.name}`,
      ),
    }).catch((err) => console.error("[users] notify failed:", err));
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
  if (target.roles.includes("ADMIN") || isImmutableAdmin(target.telegramId)) {
    return NextResponse.json({ error: "Administrators cannot be deleted through Sentinel" }, { status: 403 });
  }

  // Active users WITH roles must be deactivated first (safety check).
  // Pending users (no roles) can be deleted directly — they never had access.
  if (target.status === "ACTIVE" && target.roles.length > 0) {
    return NextResponse.json({ error: "Deactivate the user before deleting" }, { status: 400 });
  }

  // Clean up related records before deleting
  await prisma.notification.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });

  await logAudit({
    userId: user.id,
    action: "DELETE_USER",
    entityType: "User",
    entityId: id,
    before: { name: target.name, telegramId: target.telegramId, roles: target.roles },
    userName: user.name,
    details: `Permanently deleted ${target.name} (@${target.telegramUser})`,
    request: req,
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
