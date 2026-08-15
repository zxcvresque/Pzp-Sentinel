import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const schedule = await prisma.scheduledBroadcast.findUnique({ where: { id } });
  if (!schedule || !schedule.active) {
    return NextResponse.json({ error: "Repeating broadcast not found" }, { status: 404 });
  }

  await prisma.scheduledBroadcast.update({
    where: { id },
    data: { active: false },
  });
  await logAudit({
    userId: user.id,
    action: "BROADCAST_SCHEDULE_CANCELLED",
    entityType: "ScheduledBroadcast",
    entityId: id,
    before: { title: schedule.title, nextFire: schedule.nextFire },
    userName: user.name,
    details: `Cancelled repeating broadcast “${schedule.title}”`,
  });

  return NextResponse.json({ success: true });
}
