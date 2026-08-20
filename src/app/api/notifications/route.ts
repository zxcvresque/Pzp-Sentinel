import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeRead = req.nextUrl.searchParams.get("includeRead") === "true";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit")) || 30));
  const where = { userId: user.id, ...(includeRead ? {} : { read: false }) };
  const [notifications, total, unreadCount] = await Promise.all([prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  }), prisma.notification.count({ where }), prisma.notification.count({ where: { userId: user.id, read: false } })]);

  return NextResponse.json({ notifications, total, unreadCount, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ success: true });
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: body.ids }, userId: user.id },
      data: { read: true },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "Provide { ids: string[] } or { markAllRead: true }" },
    { status: 400 }
  );
}
