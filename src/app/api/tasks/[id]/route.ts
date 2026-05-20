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
  const { status, assigneeId, priority, title, description, deadline, startDate, tagIds } = body;

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;
  if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
  if (priority !== undefined) data.priority = priority;
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (tagIds !== undefined) data.tags = { set: tagIds.map((tid: string) => ({ id: tid })) };

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
