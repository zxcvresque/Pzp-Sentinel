import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id, read: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ notifications });
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
