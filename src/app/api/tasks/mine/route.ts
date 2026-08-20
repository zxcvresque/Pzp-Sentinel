import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only users with DEV role (or ADMIN) can access their tasks
  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tasks = await prisma.task.findMany({
    where: {
      parentId: null,
      archivedAt: null,
      project: { archivedAt: null },
      OR: [
        { assigneeId: user.id },
        { subtasks: { some: { assigneeId: user.id, archivedAt: null } } },
      ],
    },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } },
      tags: true,
      subtasks: {
        where: { archivedAt: null },
        include: { assignee: { select: { id: true, name: true, photoUrl: true, telegramUser: true } }, tags: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ tasks });
}
