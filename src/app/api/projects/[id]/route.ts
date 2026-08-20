import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canManageProject, projectAccessFor } from "@/lib/project-access";

async function authorize() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const role = await projectAccessFor(auth.user!, id);
  if (!canManageProject(role)) return NextResponse.json({ error: "Only a project lead or admin can update this project" }, { status: 403 });

  const { name, description, repoUrl, trackedRepoId, members, restore } = await req.json();
  if (restore === true) {
    const project = await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({ where: { projectId: id, archivedAt: { not: null } }, data: { archivedAt: null, archivedById: null } });
      return tx.project.update({ where: { id }, data: { archivedAt: null, archivedById: null, status: "ACTIVE" } });
    });
    await logAudit({ userId: auth.user!.id, userName: auth.user!.name, action: "PROJECT_RESTORE", entityType: "Project", entityId: id, before: existing, after: project, request: req });
    return NextResponse.json({ project });
  }
  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Name and description are required" }, { status: 400 });
  }

  const resolvedTrackedRepoId = trackedRepoId || (repoUrl
    ? (await prisma.trackedRepo.findFirst({ where: { url: repoUrl.trim() }, select: { id: true } }))?.id
    : null);
  if (resolvedTrackedRepoId && !await prisma.trackedRepo.findUnique({ where: { id: resolvedTrackedRepoId }, select: { id: true } })) {
    return NextResponse.json({ error: "Tracked repository not found" }, { status: 400 });
  }
  const memberRows: Array<{ userId: string; role: "LEAD" | "MEMBER" | "VIEWER" }> = Array.isArray(members)
    ? members.filter((entry: unknown): entry is { userId: string; role: "LEAD" | "MEMBER" | "VIEWER" } => {
        if (!entry || typeof entry !== "object") return false;
        const row = entry as { userId?: unknown; role?: unknown };
        return typeof row.userId === "string" && ["LEAD", "MEMBER", "VIEWER"].includes(String(row.role));
      })
    : [];
  if (memberRows.length && !memberRows.some((entry) => entry.role === "LEAD")) {
    return NextResponse.json({ error: "A project must have at least one lead" }, { status: 400 });
  }
  if (memberRows.length) {
    const valid = await prisma.user.count({ where: { id: { in: memberRows.map((entry) => entry.userId) }, status: "ACTIVE", roles: { hasSome: ["DEV", "ADMIN"] } } });
    if (valid !== new Set(memberRows.map((entry) => entry.userId)).size) return NextResponse.json({ error: "Invalid project member" }, { status: 400 });
  }

  const project = await prisma.$transaction(async (db) => {
    if (memberRows.length) {
      await db.projectMember.deleteMany({ where: { projectId: id } });
      await db.projectMember.createMany({ data: memberRows.map((entry) => ({ projectId: id, ...entry })) });
    }
    return db.project.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description.trim(),
        repoUrl: repoUrl?.trim() || null,
        trackedRepoId: resolvedTrackedRepoId || null,
        ...(memberRows.length ? { members: { set: memberRows.map((entry) => ({ id: entry.userId })) } } : {}),
      },
      include: { memberships: { include: { user: { select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true } } } } },
    });
  });

  await logAudit({
    userId: auth.user!.id,
    userName: auth.user!.name,
    action: "PROJECT_UPDATE",
    entityType: "Project",
    entityId: id,
    before: existing,
    after: project,
    details: `Updated project ${project.name}`,
    request: req,
  });

  return NextResponse.json({ project: { ...project, members: project.memberships.map((membership) => ({ ...membership.user, projectRole: membership.role })) } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const role = await projectAccessFor(auth.user!, id);
  if (!canManageProject(role)) return NextResponse.json({ error: "Only a project lead or admin can archive this project" }, { status: 403 });

  await prisma.$transaction(async (tx) => {
    const archivedAt = new Date();
    await tx.task.updateMany({ where: { projectId: id, archivedAt: null }, data: { archivedAt, archivedById: auth.user!.id } });
    await tx.project.update({ where: { id }, data: { status: "ARCHIVED", archivedAt, archivedById: auth.user!.id } });
  });

  await logAudit({
    userId: auth.user!.id,
    userName: auth.user!.name,
    action: "PROJECT_ARCHIVE",
    entityType: "Project",
    entityId: id,
    before: existing,
    details: `Archived project ${existing.name}`,
    request: req,
  });

  return NextResponse.json({ success: true });
}
