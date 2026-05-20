import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = req.nextUrl;
  const action = url.searchParams.get("action");
  const entityType = url.searchParams.get("entityType");
  const cursor = url.searchParams.get("cursor");
  const take = 50;

  const where: Record<string, string> = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = logs.length > take;
  const items = hasMore ? logs.slice(0, take) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  // Collect unique user IDs and fetch their names
  const userIds = [...new Set(items.map((l) => l.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap: Record<string, string> = {};
  for (const u of users) {
    userMap[u.id] = u.name;
  }

  // Collect distinct action and entityType values for filter options
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
  ]);

  return NextResponse.json({
    logs: items,
    nextCursor,
    userMap,
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType),
  });
}
