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
  const userId = url.searchParams.get("userId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const cursor = url.searchParams.get("cursor");
  const take = 50;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (userId) where.userId = userId;
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

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
    select: { id: true, name: true, photoUrl: true, telegramUser: true },
  });
  const userMap: Record<string, string> = {};
  for (const u of users) {
    userMap[u.id] = u.name;
  }

  // Collect distinct action, entityType, and userId values for filter options
  const [actions, entityTypes, distinctUserIds] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
    prisma.auditLog.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);

  // Fetch names for all users who have audit entries (for user filter dropdown)
  const allAuditUserIds = distinctUserIds.map((d) => d.userId);
  const auditUsers = await prisma.user.findMany({
    where: { id: { in: allAuditUserIds } },
    select: { id: true, name: true },
  });

  return NextResponse.json({
    logs: items,
    nextCursor,
    userMap,
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType),
    users: auditUsers,
  });
}
