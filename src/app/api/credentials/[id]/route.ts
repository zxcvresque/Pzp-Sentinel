import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!isAdmin) {
    return NextResponse.json({ error: "Only admins can update credentials" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { platform, label, value, assigneeIds } = body;

  const existing = await prisma.credential.findUnique({
    where: { id },
    include: { assignees: { select: { id: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const previousAssigneeIds = new Set(existing.assignees.map((a) => a.id));

  const credential = await prisma.credential.update({
    where: { id },
    data: {
      ...(platform && { platform }),
      ...(label && { label }),
      ...(value && { value }),
      ...(assigneeIds !== undefined && {
        assignees: { set: assigneeIds.map((aid: string) => ({ id: aid })) },
      }),
    },
    include: {
      assignees: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
    },
  });

  // GitHub immutable log
  logCredentialAction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: credential.platform,
    details: `Updated: ${credential.label}`,
  });

  // Notify newly added assignees
  if (assigneeIds !== undefined) {
    const newAssignees = credential.assignees.filter(
      (a) => !previousAssigneeIds.has(a.id),
    );
    for (const assignee of newAssignees) {
      notify({
        userId: assignee.id,
        type: "CREDENTIAL_ASSIGNED",
        title: "Credential Shared",
        message: `${credential.platform} -- ${credential.label} has been shared with you by ${user.name}.`,
        entityId: id,
        priority: "NORMAL",
        telegramMessage: formatTgMessage(
          "🔐 Credential Shared",
          `${credential.platform} -- ${credential.label}`,
          `Shared by ${user.name}`,
        ),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ credential });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!isAdmin) {
    return NextResponse.json({ error: "Only admins can delete credentials" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.credential.findUnique({ where: { id } });
  await prisma.credential.deleteMany({ where: { parentId: id } });
  await prisma.credential.delete({ where: { id } });

  // GitHub immutable log
  logCredentialAction({
    action: "DELETED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: existing?.platform || "unknown",
    details: `Deleted: ${existing?.label || id}`,
  });

  return NextResponse.json({ success: true });
}
