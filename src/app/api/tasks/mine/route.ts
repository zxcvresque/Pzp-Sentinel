import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tasks = await prisma.task.findMany({
    where: { assigneeId: user.id, parentId: null },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      tags: true,
      subtasks: {
        include: { assignee: { select: { id: true, name: true } }, tags: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ tasks });
}
