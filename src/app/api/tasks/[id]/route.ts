import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

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

  const body = await req.json();
  const { status, assigneeId, priority, title, description, deadline, startDate, tagIds, parentId } = body;

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
  if (priority !== undefined) data.priority = priority;
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (tagIds !== undefined) data.tags = { set: tagIds.map((tid: string) => ({ id: tid })) };
  if (parentId !== undefined) data.parentId = parentId || null;

  const updated = await prisma.task.update({
    where: { id },
    data,
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      tags: true,
      subtasks: { include: { assignee: { select: { id: true, name: true } } } },
    },
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

  // Only the creator or an ADMIN can delete
  const isAdmin = hasRole(user.roles, "ADMIN");
  if (task.createdById !== user.id && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete subtasks first, then the parent task
  if (task.subtasks.length > 0) {
    await prisma.task.deleteMany({
      where: { parentId: id },
    });
  }

  await prisma.task.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
