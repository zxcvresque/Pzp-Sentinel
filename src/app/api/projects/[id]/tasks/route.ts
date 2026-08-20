import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { TaskStatus } from "@/generated/prisma/enums";
import { canWriteProject, projectAccessFor } from "@/lib/project-access";
import { logAudit } from "@/lib/audit";
import { notify, formatTgMessage } from "@/lib/notifications";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const access = await projectAccessFor(user, id);
  if (!access) return NextResponse.json({ error: "You are not a member of this project" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as TaskStatus | null;

  const where: { projectId: string; status?: TaskStatus; archivedAt: null } = { projectId: id, archivedAt: null };
  if (status) where.status = status;

  const tasks = await prisma.task.findMany({
    where: { ...where, parentId: null },
    include: {
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tags: true,
      subtasks: {
        where: { archivedAt: null },
        include: { assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } }, tags: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ tasks });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const access = await projectAccessFor(user, id);
  if (!canWriteProject(access)) return NextResponse.json({ error: "Project membership with write access is required" }, { status: 403 });

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title, description, priority, status, assigneeId, deadline, startDate, tagIds, parentId } = body;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const validPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  if (priority !== undefined && !validPriorities.includes(priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  const parsedDeadline = deadline ? new Date(deadline) : null;
  const parsedStart = startDate ? new Date(startDate) : null;
  if ((parsedDeadline && Number.isNaN(parsedDeadline.getTime())) || (parsedStart && Number.isNaN(parsedStart.getTime()))) {
    return NextResponse.json({ error: "Invalid task date" }, { status: 400 });
  }
  if (assigneeId) {
    const assignee = await prisma.projectMember.findFirst({
      where: { projectId: id, userId: assigneeId, user: { status: "ACTIVE", roles: { has: "DEV" } } },
      select: { id: true },
    });
    const legacy = assignee ? null : await prisma.project.findFirst({ where: { id, members: { some: { id: assigneeId, status: "ACTIVE", roles: { has: "DEV" } } } }, select: { id: true } });
    if (!assignee && !legacy) return NextResponse.json({ error: "Assignee must be an active developer in this project" }, { status: 400 });
  }
  if (parentId) {
    const parent = await prisma.task.findFirst({ where: { id: parentId, projectId: id, archivedAt: null }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "Parent task must belong to this project" }, { status: 400 });
  }
  const uniqueTagIds = Array.isArray(tagIds) ? [...new Set(tagIds.filter((tagId: unknown): tagId is string => typeof tagId === "string"))] : [];
  if (uniqueTagIds.length) {
    const tagCount = await prisma.tag.count({ where: { id: { in: uniqueTagIds }, projectId: id } });
    if (tagCount !== uniqueTagIds.length) return NextResponse.json({ error: "Every tag must belong to this project" }, { status: 400 });
  }

  // Honor the chosen column; fall back to the schema default only if absent/invalid.
  const validStatuses = Object.values(TaskStatus) as string[];
  const taskStatus =
    typeof status === "string" && validStatuses.includes(status)
      ? (status as TaskStatus)
      : undefined;

  const task = await prisma.task.create({
    data: {
      projectId: id,
      title,
      description: description || null,
      priority: priority || "MEDIUM",
      status: taskStatus,
      assigneeId: assigneeId || null,
      deadline: parsedDeadline,
      startDate: parsedStart,
      parentId: parentId || null,
      tags: uniqueTagIds.length ? { connect: uniqueTagIds.map((tid) => ({ id: tid })) } : undefined,
      createdById: user.id,
    },
    include: {
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tags: true,
      subtasks: { include: { assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } } },
    },
  });

  await logAudit({
    userId: user.id,
    action: "TASK_CREATE",
    entityType: "Task",
    entityId: task.id,
    after: { projectId: id, title: task.title, assigneeId: task.assigneeId, parentId: task.parentId, status: task.status, priority: task.priority, tagIds: uniqueTagIds },
    userName: user.name,
    request: req,
  });
  if (task.assigneeId && task.assigneeId !== user.id) {
    await notify({
      userId: task.assigneeId,
      type: "TASK_ASSIGNED",
      title: "Task Assigned",
      message: `You have been assigned to: ${task.title}. Assigned by ${user.name}.`,
      entityId: task.id,
      actionUrl: "/dev/tasks",
      telegramMessage: formatTgMessage("Task Assigned", task.title, `Assigned by ${user.name}`),
    });
  }

  return NextResponse.json({ task }, { status: 201 });
}
