import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";

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

  const existing = await prisma.credential.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
      assignees: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
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
