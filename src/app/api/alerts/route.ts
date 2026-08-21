import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = req.nextUrl.searchParams.get("status") === "RESOLVED" ? "RESOLVED" : "OPEN";
  const alerts = await prisma.operationalAlert.findMany({
    where: { status },
    include: {
      service: { select: { id: true, name: true } },
      credential: { select: { id: true, label: true, platform: true } },
      vpsServer: { select: { id: true, name: true } },
    },
    orderBy: [{ severity: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ alerts });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action === "REOPEN" ? "REOPEN" : body?.action === "RESOLVE" ? "RESOLVE" : null;
  if (!id || !action) return NextResponse.json({ error: "Choose an alert action" }, { status: 400 });
  const existing = await prisma.operationalAlert.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  const alert = await prisma.operationalAlert.update({
    where: { id },
    data: action === "RESOLVE" ? { status: "RESOLVED", resolvedAt: new Date() } : { status: "OPEN", resolvedAt: null },
  });
  await logAudit({ userId: user.id, action: `OPERATIONAL_ALERT_${action}`, entityType: "OperationalAlert", entityId: id, before: existing, after: alert, userName: user.name, request: req });
  return NextResponse.json({ alert });
}
