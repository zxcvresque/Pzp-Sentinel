import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tracked = await prisma.trackedRepo.findMany({
    where: hasRole(user.roles, "ADMIN") ? {} : {
      projects: { some: {
        archivedAt: null,
        OR: [
          { memberships: { some: { userId: user.id } } },
          { members: { some: { id: user.id } } },
        ],
      } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tracked });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name, fullName, url } = await req.json();

  if (!name || !fullName || !url) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const existing = await prisma.trackedRepo.findUnique({ where: { fullName } });
  if (existing) {
    return NextResponse.json({ error: "Already tracked" }, { status: 409 });
  }

  const repo = await prisma.trackedRepo.create({
    data: { name, fullName, url, addedById: user.id },
  });

  await logAudit({
    userId: user.id,
    action: "TRACKED_REPO_CREATE",
    entityType: "TrackedRepo",
    entityId: repo.id,
    after: repo,
    userName: user.name,
    request: req,
  });

  return NextResponse.json({ repo }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { fullName } = await req.json();
  if (!fullName) {
    return NextResponse.json({ error: "fullName required" }, { status: 400 });
  }

  const repo = await prisma.trackedRepo.findUnique({ where: { fullName } });
  if (!repo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.trackedRepo.delete({ where: { fullName } });
  await logAudit({
    userId: user.id,
    action: "TRACKED_REPO_DELETE",
    entityType: "TrackedRepo",
    entityId: repo.id,
    before: repo,
    userName: user.name,
    request: req,
  });
  return NextResponse.json({ success: true });
}
