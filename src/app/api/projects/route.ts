import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const projects = await prisma.project.findMany({
    where: { status: "ACTIVE" },
    include: {
      members: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tasks: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = projects.map((p) => {
    const taskCounts: Record<string, number> = {
      BACKLOG: 0,
      TODO: 0,
      IN_PROGRESS: 0,
      REVIEW: 0,
      DONE: 0,
    };
    for (const t of p.tasks) {
      taskCounts[t.status] = (taskCounts[t.status] || 0) + 1;
    }
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      repoUrl: p.repoUrl,
      status: p.status,
      members: p.members,
      taskCounts,
      createdAt: p.createdAt,
    };
  });

  return NextResponse.json({ projects: result });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, repoUrl } = body;

  if (!name || !description) {
    return NextResponse.json(
      { error: "Name and description are required" },
      { status: 400 }
    );
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      repoUrl: repoUrl || null,
    },
    include: {
      members: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
