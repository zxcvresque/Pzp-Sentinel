import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { notify, formatTgMessage } from "@/lib/notifications";
import { canManageProject, canWriteProject, projectAccessFor } from "@/lib/project-access";
import { logAudit } from "@/lib/audit";
import { Priority, TaskStatus } from "@/generated/prisma/enums";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
  const projectRole = await projectAccessFor(user, task.projectId);
  if (!canWriteProject(projectRole)) return NextResponse.json({ error: "Project membership with write access is required" }, { status: 403 });

  const body = await req.json();
  const { status, assigneeId, priority, title, description, deadline, startDate, tagIds, parentId, restore } = body;

  // A DEV may fully edit their OWN tasks — ones assigned to them OR created by
  // them — but not anyone else's. ADMINs can edit any task.
  if (!isAdmin && !canManageProject(projectRole) && task.assigneeId !== user.id && task.createdById !== user.id) {
    return NextResponse.json(
      { error: "Forbidden: you can only edit your own tasks" },
      { status: 403 },
    );
  }

  if (restore === true) {
    if (!canManageProject(projectRole) && task.createdById !== user.id) return NextResponse.json({ error: "Only a project lead, admin, or creator can restore this task" }, { status: 403 });
    const restored = await prisma.task.update({ where: { id }, data: { archivedAt: null, archivedById: null } });
    await logAudit({ userId: user.id, action: "TASK_RESTORE", entityType: "Task", entityId: id, before: task, after: restored, userName: user.name, request: req });
    return NextResponse.json({ task: restored });
  }
  if (task.archivedAt) return NextResponse.json({ error: "Archived tasks must be restored before editing" }, { status: 409 });

  const validStatuses = Object.values(TaskStatus) as string[];
  const validPriorities = Object.values(Priority) as string[];
  if (status !== undefined && !validStatuses.includes(status)) return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
  if (priority !== undefined && !validPriorities.includes(priority)) return NextResponse.json({ error: "Invalid task priority" }, { status: 400 });
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.trim().length > 200)) return NextResponse.json({ error: "Task title must be 1-200 characters" }, { status: 400 });
  if (deadline !== undefined && deadline && Number.isNaN(new Date(deadline).getTime())) return NextResponse.json({ error: "Invalid deadline" }, { status: 400 });
  if (startDate !== undefined && startDate && Number.isNaN(new Date(startDate).getTime())) return NextResponse.json({ error: "Invalid start date" }, { status: 400 });
  if (assigneeId !== undefined && assigneeId) {
    const member = await prisma.projectMember.findFirst({ where: { projectId: task.projectId, userId: assigneeId, user: { status: "ACTIVE", roles: { has: "DEV" } } }, select: { id: true } });
    const legacy = member ? null : await prisma.project.findFirst({ where: { id: task.projectId, members: { some: { id: assigneeId, status: "ACTIVE", roles: { has: "DEV" } } } }, select: { id: true } });
    if (!member && !legacy) return NextResponse.json({ error: "Assignee must be an active developer in this project" }, { status: 400 });
  }
  if (parentId !== undefined && parentId) {
    if (parentId === id) return NextResponse.json({ error: "A task cannot be its own parent" }, { status: 400 });
    const parent = await prisma.task.findFirst({ where: { id: parentId, projectId: task.projectId, archivedAt: null }, select: { id: true, parentId: true } });
    if (!parent || parent.parentId === id) return NextResponse.json({ error: "Parent task must belong to this project and cannot create a cycle" }, { status: 400 });
  }
  const uniqueTagIds = tagIds !== undefined && Array.isArray(tagIds) ? [...new Set(tagIds.filter((tagId: unknown): tagId is string => typeof tagId === "string"))] : null;
  if (uniqueTagIds?.length) {
    const count = await prisma.tag.count({ where: { id: { in: uniqueTagIds }, projectId: task.projectId } });
    if (count !== uniqueTagIds.length) return NextResponse.json({ error: "Every tag must belong to this project" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
  if (priority !== undefined) data.priority = priority;
  if (title !== undefined) data.title = title.trim();
  if (description !== undefined) data.description = description;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (uniqueTagIds !== null) data.tags = { set: uniqueTagIds.map((tid) => ({ id: tid })) };
  if (parentId !== undefined) data.parentId = parentId || null;

  const updated = await prisma.task.update({
    where: { id },
    data,
    include: {
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      project: { select: { id: true, name: true } },
      tags: true,
      subtasks: { include: { assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } } },
    },
  });

  // Notify new assignee when task is assigned
  if (assigneeId !== undefined && assigneeId !== null && assigneeId !== task.assigneeId) {
    notify({
      userId: assigneeId,
      type: "TASK_ASSIGNED",
      title: "Task Assigned",
      message: `You have been assigned to: ${updated.title}. Assigned by ${user.name}.`,
      entityId: id,
      priority: "NORMAL",
      actionUrl: "/dev/tasks",
      telegramMessage: formatTgMessage(
        "📋 Task Assigned",
        updated.title,
        `Assigned by ${user.name}`,
      ),
    }).catch((err) => console.error("[task] notify failed:", err));
  }

  await logAudit({
    userId: user.id,
    action: "TASK_UPDATE",
    entityType: "Task",
    entityId: id,
    before: task,
    after: updated,
    userName: user.name,
    request: req,
  });

  return NextResponse.json({ task: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: { subtasks: { select: { id: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const projectRole = await projectAccessFor(user, task.projectId);
  if (!canWriteProject(projectRole)) return NextResponse.json({ error: "Project membership with write access is required" }, { status: 403 });
  // Only the creator, project lead, or an ADMIN can archive.
  const isAdmin = hasRole(user.roles, "ADMIN");
  if (task.createdById !== user.id && !isAdmin && !canManageProject(projectRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const archivedAt = new Date();
  await prisma.$transaction([
    prisma.task.updateMany({ where: { parentId: id, archivedAt: null }, data: { archivedAt, archivedById: user.id } }),
    prisma.task.update({ where: { id }, data: { archivedAt, archivedById: user.id } }),
  ]);
  await logAudit({ userId: user.id, action: "TASK_ARCHIVE", entityType: "Task", entityId: id, before: task, after: { archivedAt }, userName: user.name, request: req });

  return NextResponse.json({ success: true });
}
