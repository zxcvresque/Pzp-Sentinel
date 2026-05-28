import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tracked = await prisma.trackedRepo.findMany({
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
  return NextResponse.json({ success: true });
}
