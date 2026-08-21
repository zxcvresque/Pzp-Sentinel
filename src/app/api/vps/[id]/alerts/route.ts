import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { DEFAULT_VPS_ALERT_PREFERENCE } from "@/lib/vps-alerts";

const BOOLEAN_FIELDS = [
  "enabled",
  "notifyOffline",
  "notifyCpu",
  "notifyMemory",
  "notifyDisk",
  "notifyLoad",
  "notifyProcess",
  "inApp",
  "telegram",
] as const;

async function alertAccess(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, serverId: string) {
  const server = await prisma.vpsServer.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      name: true,
      alertsEnabled: true,
      maintainers: { where: { id: user.id }, select: { id: true } },
    },
  });
  if (!server) return { error: "VPS not found", status: 404 } as const;
  if (!hasRole(user.roles, "ADMIN") && !server.maintainers.length) {
    return { error: "Only assigned maintainers can configure VPS alerts", status: 403 } as const;
  }
  return { server } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await alertAccess(user, id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const preference = await prisma.vpsAlertPreference.upsert({
    where: { userId_vpsServerId: { userId: user.id, vpsServerId: id } },
    create: { userId: user.id, vpsServerId: id, ...DEFAULT_VPS_ALERT_PREFERENCE },
    update: {},
  });

  return NextResponse.json({
    preference,
    alertsEnabled: access.server.alertsEnabled,
    telegramAvailable: Boolean(user.chatId),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await alertAccess(user, id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json();
  const current = await prisma.vpsAlertPreference.findUnique({
    where: { userId_vpsServerId: { userId: user.id, vpsServerId: id } },
  });
  const next = { ...DEFAULT_VPS_ALERT_PREFERENCE, ...(current ?? {}) };
  const update: Partial<Record<(typeof BOOLEAN_FIELDS)[number], boolean>> = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") {
      update[field] = body[field];
      next[field] = body[field];
    }
  }

  if (next.enabled && !next.inApp && !next.telegram) {
    return NextResponse.json({ error: "Choose at least one notification channel" }, { status: 400 });
  }
  if (next.telegram && !user.chatId) {
    return NextResponse.json({ error: "Link Telegram before enabling Telegram alerts" }, { status: 400 });
  }

  const preference = await prisma.vpsAlertPreference.upsert({
    where: { userId_vpsServerId: { userId: user.id, vpsServerId: id } },
    create: { userId: user.id, vpsServerId: id, ...DEFAULT_VPS_ALERT_PREFERENCE, ...update },
    update,
  });

  await logAudit({
    userId: user.id,
    userName: user.name,
    action: "VPS_ALERT_PREFERENCES_UPDATE",
    entityType: "VpsServer",
    entityId: id,
    before: current,
    after: preference,
    request: req,
  });

  return NextResponse.json({
    preference,
    alertsEnabled: access.server.alertsEnabled,
    telegramAvailable: Boolean(user.chatId),
  });
}
