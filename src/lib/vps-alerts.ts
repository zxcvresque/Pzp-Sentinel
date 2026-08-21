import { prisma } from "@/lib/db";
import { formatTgMessage, notify } from "@/lib/notifications";

export const VPS_ALERT_FIELDS = {
  VPS_OFFLINE: "notifyOffline",
  VPS_CPU_HIGH: "notifyCpu",
  VPS_RAM_HIGH: "notifyMemory",
  VPS_DISK_HIGH: "notifyDisk",
  VPS_LOAD_HIGH: "notifyLoad",
  VPS_PROCESS_DOWN: "notifyProcess",
} as const;

export type VpsAlertKind = keyof typeof VPS_ALERT_FIELDS;

export const DEFAULT_VPS_ALERT_PREFERENCE = {
  enabled: false,
  notifyOffline: true,
  notifyCpu: true,
  notifyMemory: true,
  notifyDisk: true,
  notifyLoad: true,
  notifyProcess: true,
  inApp: true,
  telegram: false,
} as const;

type AlertPreference = {
  enabled: boolean;
  notifyOffline: boolean;
  notifyCpu: boolean;
  notifyMemory: boolean;
  notifyDisk: boolean;
  notifyLoad: boolean;
  notifyProcess: boolean;
  inApp: boolean;
  telegram: boolean;
};

export function vpsAlertKindEnabled(preference: AlertPreference, kind: string) {
  const field = VPS_ALERT_FIELDS[kind as VpsAlertKind];
  return Boolean(field && preference.enabled && preference[field]);
}

export async function promptNewVpsMaintainers(params: {
  vpsServerId: string;
  serverName: string;
  userIds: string[];
  assignedBy: string;
}) {
  const userIds = [...new Set(params.userIds)];
  if (!userIds.length) return;

  const developers = await prisma.user.findMany({
    where: { id: { in: userIds }, status: "ACTIVE", roles: { has: "DEV" } },
    select: { id: true },
  });

  await Promise.allSettled(developers.map(async ({ id: userId }) => {
    const existing = await prisma.vpsAlertPreference.findUnique({
      where: { userId_vpsServerId: { userId, vpsServerId: params.vpsServerId } },
      select: { enabled: true },
    });
    if (existing?.enabled) return;

    await prisma.vpsAlertPreference.upsert({
      where: { userId_vpsServerId: { userId, vpsServerId: params.vpsServerId } },
      create: {
        userId,
        vpsServerId: params.vpsServerId,
        ...DEFAULT_VPS_ALERT_PREFERENCE,
        promptedAt: new Date(),
      },
      update: { promptedAt: new Date() },
    });

    await notify({
      userId,
      type: "VPS_ALERT_SETTINGS",
      title: `Choose alerts for ${params.serverName}`,
      message: `${params.assignedBy} assigned you to this VPS. Alerts are off by default; choose the incidents and channels you want.`,
      entityId: params.vpsServerId,
      priority: "HIGH",
      actionUrl: "/dev/vps",
      actionLabel: "Choose VPS alerts",
      telegramMessage: formatTgMessage(
        "VPS assignment",
        `You are now responsible for ${params.serverName}.`,
        "Alerts are off by default. Open Sentinel to choose offline, resource, load and process notifications.",
      ),
    });
  }));
}

export async function notifyVpsAlertSubscribers(params: {
  vpsServerId: string;
  kind: string;
  title: string;
  message: string;
}) {
  const preferences = await prisma.vpsAlertPreference.findMany({
    where: {
      vpsServerId: params.vpsServerId,
      enabled: true,
      user: {
        status: "ACTIVE",
        maintainedVpsServers: { some: { id: params.vpsServerId } },
      },
    },
  });

  const subscribed = preferences.filter((preference) => vpsAlertKindEnabled(preference, params.kind));
  await Promise.allSettled(subscribed.map((preference) => notify({
    userId: preference.userId,
    type: "VPS_ALERT",
    title: params.title,
    message: params.message,
    entityId: params.vpsServerId,
    priority: "HIGH",
    actionUrl: "/dev/vps",
    actionLabel: "Open VPS stats",
    telegramMessage: formatTgMessage("VPS alert", params.title, params.message),
    inAppOverride: preference.inApp,
    telegramOverride: preference.telegram,
  })));
}
