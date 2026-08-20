import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { projectAccessFor } from "@/lib/project-access";
import { logAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only ADMIN and DEV can read tags
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ tags: [] });
  if (!await projectAccessFor(user, projectId)) return NextResponse.json({ error: "Project membership required" }, { status: 403 });
  const tags = await prisma.tag.findMany({ where: { projectId }, orderBy: { name: "asc" } });
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Only ADMIN can create tags
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, color, projectId } = await req.json();
  if (!name || !projectId) return NextResponse.json({ error: "Name and project are required" }, { status: 400 });
  if (!await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const tag = await prisma.tag.upsert({
    where: { projectId_name: { projectId, name: name.trim() } },
    update: { color: color || undefined },
    create: { name: name.trim(), projectId, color: color || "#c8ff00" },
  });

  await logAudit({ userId: user.id, action: "TAG_UPSERT", entityType: "Tag", entityId: tag.id, after: tag, userName: user.name, request: req });

  return NextResponse.json({ tag }, { status: 201 });
}
