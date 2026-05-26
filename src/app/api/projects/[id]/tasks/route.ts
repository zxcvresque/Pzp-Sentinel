import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import type { TaskStatus } from "@/generated/prisma/enums";

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
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as TaskStatus | null;

  const where: { projectId: string; status?: TaskStatus } = { projectId: id };
  if (status) where.status = status;

  const tasks = await prisma.task.findMany({
    where: { ...where, parentId: null },
    include: {
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tags: true,
      subtasks: {
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

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title, description, priority, assigneeId, deadline, startDate, tagIds, parentId } = body;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      projectId: id,
      title,
      description: description || null,
      priority: priority || "MEDIUM",
      assigneeId: assigneeId || null,
      deadline: deadline ? new Date(deadline) : null,
      startDate: startDate ? new Date(startDate) : null,
      parentId: parentId || null,
      tags: tagIds?.length ? { connect: tagIds.map((tid: string) => ({ id: tid })) } : undefined,
      createdById: user.id,
    },
    include: {
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tags: true,
      subtasks: { include: { assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } } },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
