import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin = hasRole(user.roles, "ADMIN");

    if (isAdmin) {
      const credentials = await prisma.credential.findMany({
        where: { parentId: null },
        include: {
          assignees: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
          createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
          revisions: {
            where: { status: "PENDING" },
            include: { createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ platform: "asc" }, { label: "asc" }],
      });
      return NextResponse.json({ credentials });
    }

    if (hasRole(user.roles, "DEV")) {
      const credentials = await prisma.credential.findMany({
        where: {
          assignees: { some: { id: user.id } },
          parentId: null,
          status: "APPROVED",
        },
        include: {
          assignees: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
          createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
        },
        orderBy: [{ platform: "asc" }, { label: "asc" }],
      });

      const pendingByMe = await prisma.credential.findMany({
        where: { createdById: user.id, status: "PENDING" },
        include: { parent: { select: { id: true, platform: true, label: true } } },
        orderBy: { createdAt: "desc" },
      });

      return NextResponse.json({ credentials, pending: pendingByMe });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDev = hasRole(user.roles, "DEV");
  if (!isAdmin && !isDev) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { platform, label, value, assigneeIds, parentId } = body;

  if (!platform || !label || !value) {
    return NextResponse.json(
      { error: "Platform, label, and value are required" },
      { status: 400 },
    );
  }

  if (isAdmin) {
    const credential = await prisma.credential.create({
      data: {
        platform,
        label,
        value,
        status: "APPROVED",
        createdById: user.id,
        assignees: assigneeIds?.length
          ? { connect: assigneeIds.map((id: string) => ({ id })) }
          : undefined,
      },
      include: {
        assignees: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
        createdBy: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      },
    });
    // GitHub immutable log
    logCredentialAction({
      action: "CREATED",
      userId: user.id,
      userName: user.name,
      entityId: credential.id,
      platform,
      details: `Admin created: ${label}`,
    });

    // Notify each assignee about the shared credential
    if (assigneeIds?.length) {
      for (const assigneeId of assigneeIds) {
        notify({
          userId: assigneeId,
          type: "CREDENTIAL_ASSIGNED",
          title: "Credential Shared",
          message: `${platform} -- ${label} has been shared with you by ${user.name}.`,
          entityId: credential.id,
          priority: "NORMAL",
          actionUrl: "/credentials",
          telegramMessage: formatTgMessage(
            "🔐 Credential Shared",
            `${platform} · ${label}`,
            `Shared by ${user.name}`,
          ),
        }).catch((err) => console.error("[cred] notify failed:", err));
      }
    }

    return NextResponse.json({ credential }, { status: 201 });
  }

  const credential = await prisma.credential.create({
    data: {
      platform,
      label,
      value,
      status: "PENDING",
      createdById: user.id,
      parentId: parentId || null,
    },
  });
  // GitHub immutable log
  logCredentialAction({
    action: "PROPOSED",
    userId: user.id,
    userName: user.name,
    entityId: credential.id,
    platform,
    details: `Dev proposed: ${label}${parentId ? ` (revision of ${parentId.slice(0, 8)})` : ""}`,
  });

  return NextResponse.json({ credential, message: "Submitted for admin approval" }, { status: 201 });
}
