import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

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

  const { name, description, repoUrl } = await req.json();
  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Name and description are required" }, { status: 400 });
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: name.trim(),
      description: description.trim(),
      repoUrl: repoUrl?.trim() || null,
    },
    include: {
      members: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
    },
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
  });

  return NextResponse.json({ project });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    // Self-referencing subtasks must be removed before their parent tasks.
    await tx.task.deleteMany({ where: { projectId: id, parentId: { not: null } } });
    await tx.task.deleteMany({ where: { projectId: id } });
    await tx.project.delete({ where: { id } });
  });

  await logAudit({
    userId: auth.user!.id,
    userName: auth.user!.name,
    action: "PROJECT_DELETE",
    entityType: "Project",
    entityId: id,
    before: existing,
    details: `Deleted project ${existing.name}`,
  });

  return NextResponse.json({ success: true });
}
