import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
  const archived = req.nextUrl.searchParams.get("archived") === "true";
  const projects = await prisma.project.findMany({
    where: {
      status: archived ? "ARCHIVED" : "ACTIVE",
      archivedAt: archived ? { not: null } : null,
      ...(!isAdmin ? {
        OR: [
          { memberships: { some: { userId: user.id } } },
          { members: { some: { id: user.id } } },
        ],
      } : {}),
    },
    include: {
      members: { select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true } },
      memberships: { include: { user: { select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true } } } },
      tasks: { where: { archivedAt: null }, select: { status: true } },
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
      members: p.memberships.length
        ? p.memberships.map((membership) => ({ ...membership.user, projectRole: membership.role }))
        : p.members.map((member) => ({ ...member, projectRole: "MEMBER" })),
      taskCounts,
      createdAt: p.createdAt,
      archivedAt: p.archivedAt,
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
  const { name, description, repoUrl, trackedRepoId, memberIds } = body;
  const resolvedTrackedRepoId = trackedRepoId || (repoUrl
    ? (await prisma.trackedRepo.findFirst({ where: { url: repoUrl.trim() }, select: { id: true } }))?.id
    : null);

  if (!name || !description) {
    return NextResponse.json(
      { error: "Name and description are required" },
      { status: 400 }
    );
  }

  if (resolvedTrackedRepoId && !await prisma.trackedRepo.findUnique({ where: { id: resolvedTrackedRepoId }, select: { id: true } })) {
    return NextResponse.json({ error: "Tracked repository not found" }, { status: 400 });
  }
  const requestedMembers = Array.isArray(memberIds) ? memberIds.filter((id): id is string => typeof id === "string") : [];
  const ids = [...new Set([user.id, ...requestedMembers])];
  const validMembers = await prisma.user.findMany({
    where: { id: { in: ids }, status: "ACTIVE", roles: { hasSome: ["DEV", "ADMIN"] } },
    select: { id: true },
  });
  if (validMembers.length !== ids.length) return NextResponse.json({ error: "Every project member must be an active developer or admin" }, { status: 400 });

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description.trim(),
      repoUrl: repoUrl || null,
      trackedRepoId: resolvedTrackedRepoId || null,
      createdById: user.id,
      members: { connect: ids.map((id) => ({ id })) },
      memberships: {
        create: ids.map((id) => ({ userId: id, role: id === user.id ? "LEAD" : "MEMBER" })),
      },
    },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true } } } },
    },
  });

  await logAudit({
    userId: user.id,
    action: "PROJECT_CREATE",
    entityType: "Project",
    entityId: project.id,
    after: { name: project.name, trackedRepoId: project.trackedRepoId, memberIds: ids },
    userName: user.name,
    request: req,
  });

  return NextResponse.json({
    project: {
      ...project,
      members: project.memberships.map((membership) => ({ ...membership.user, projectRole: membership.role })),
    },
  }, { status: 201 });
}
