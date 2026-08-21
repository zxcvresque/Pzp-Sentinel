import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { syncVpsCredentials } from "@/lib/vps-credentials";
import { syncVpsSubscription, type VpsDuration } from "@/lib/vps-subscription";
import { Prisma } from "@/generated/prisma/client";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { logCredentialAction } from "@/lib/github-log";
import { logAudit } from "@/lib/audit";
import { recordFinancialEvent } from "@/lib/record-financial-event";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { projectAccessFor } from "@/lib/project-access";
import { DEFAULT_VPS_ALERT_PREFERENCE, promptNewVpsMaintainers } from "@/lib/vps-alerts";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pct(used: number, total: number) {
  return total > 0 ? (used / total) * 100 : 0;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeSshPort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22;
}

type MetricAggregate = {
  _count: { _all: number };
  _avg: {
    cpuUsage: number | null;
    ramUsage: number | null;
    ramTotal: number | null;
    diskUsage: number | null;
    diskTotal: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
  };
};

async function metricSummaries(serverIds: string[], since: Date) {
  const groups = serverIds.length ? await prisma.vpsMetric.groupBy({
    by: ["serverId"],
    where: { serverId: { in: serverIds }, createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { cpuUsage: true, ramUsage: true, ramTotal: true, diskUsage: true, diskTotal: true, load1: true, load5: true, load15: true },
  }) : [];
  return new Map(groups.map((group) => [group.serverId, group]));
}

function metricSummary(aggregate?: MetricAggregate) {
  const avg = aggregate?._avg;
  const ramUsage = avg?.ramUsage ?? 0;
  const ramTotal = avg?.ramTotal ?? 0;
  const diskUsage = avg?.diskUsage ?? 0;
  const diskTotal = avg?.diskTotal ?? 0;
  return {
    samples: aggregate?._count._all ?? 0,
    cpuUsage: round1(avg?.cpuUsage ?? 0),
    ramUsage: round1(ramUsage),
    ramTotal: round1(ramTotal),
    ramPct: round1(pct(ramUsage, ramTotal)),
    diskUsage: round1(diskUsage),
    diskTotal: round1(diskTotal),
    diskPct: round1(pct(diskUsage, diskTotal)),
    load1: round2(avg?.load1 ?? 0),
    load5: round2(avg?.load5 ?? 0),
    load15: round2(avg?.load15 ?? 0),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
  const servers = await prisma.vpsServer.findMany({
    where: isAdmin ? {} : {
      approved: true,
      OR: [
        { maintainers: { some: { id: user.id } } },
        { projects: { some: { OR: [{ memberships: { some: { userId: user.id } } }, { members: { some: { id: user.id } } }] } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      subscription: true,
      projects: { select: { id: true, name: true } },
      maintainers: { select: { id: true, name: true, photoUrl: true, telegramUser: true, githubUsername: true } },
      alerts: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  // Per-dev SSH access status per server (dev view only) — derived from the
  // dev's CredentialAccess rows on each server's linked credentials.
  const accessByServer = new Map<
    string,
    { status: "requested" | "granted"; accessLevel: string; devPublicKey: string | null }
  >();
  if (!isAdmin && servers.length) {
    const rows = await prisma.credentialAccess.findMany({
      where: { userId: user.id, credential: { vpsServerId: { in: servers.map((s) => s.id) } } },
      include: { credential: { select: { vpsServerId: true } } },
    });
    for (const a of rows) {
      const sid = a.credential.vpsServerId;
      if (!sid) continue;
      const status = a.granted ? "granted" : "requested";
      const prev = accessByServer.get(sid);
      // Prefer a granted row over a merely requested one.
      if (!prev || (prev.status !== "granted" && status === "granted")) {
        accessByServer.set(sid, { status, accessLevel: a.accessLevel, devPublicKey: a.devPublicKey });
      }
    }
  }

  const alertPreferences = servers.length ? await prisma.vpsAlertPreference.findMany({
    where: { userId: user.id, vpsServerId: { in: servers.map((server) => server.id) } },
  }) : [];
  const alertPreferenceByServer = new Map(alertPreferences.map((preference) => [preference.vpsServerId, preference]));

  const now = Date.now();
  const serverIds = servers.map((server) => server.id);
  const [weekSummaries, monthSummaries] = await Promise.all([
    metricSummaries(serverIds, new Date(now - WEEK_MS)),
    metricSummaries(serverIds, new Date(now - MONTH_MS)),
  ]);
  const result = servers.map((s) => ({
    id: s.id,
    name: s.name,
    provider: s.provider,
    ip: s.ip,
    platform: s.platform,
    username: s.username || "root",
    sshPort: s.sshPort || 22,
    notes: s.notes,
    tags: s.tags,
    sshKeyFileName: s.sshKeyFileName,
    // Plan link, billing/duration, and renewal are ADMIN-ONLY. Never exposed to
    // devs and never shared — devs see stats (+ shared credentials) only.
    ...(isAdmin
      ? {
          accessPublicKeys: s.accessPublicKeys,
          hasPassword: Boolean(s.password),
          hasSshKeyFile: Boolean(s.sshKeyFileUrl),
          planLink: s.planLink ?? null,
          subscription: s.subscription
            ? {
                mode:
                  s.subscription.frequency === "LIFETIME"
                    ? "LIFETIME"
                    : s.subscription.frequency === "ONE_TIME"
                    ? "ONE_TIME"
                    : "SUBSCRIPTION",
                frequency: s.subscription.frequency,
                price: s.subscription.price != null ? Number(s.subscription.price) : null,
                currency: s.subscription.currency,
                expiryDate: s.subscription.expiryDate?.toISOString() ?? null,
                autoRenew: s.subscription.autoRenew,
                status: s.subscription.status,
              }
            : null,
        }
      : {}),
    ...(isAdmin
      ? {}
      : { access: accessByServer.get(s.id) ?? { status: "none", accessLevel: null, devPublicKey: null } }),
    specs: s.specs,
    processHealth: s.processHealth,
    releaseVersion: s.releaseVersion,
    projects: s.projects,
    maintainers: s.maintainers,
    alerts: s.alerts,
    approved: s.approved,
    alertsEnabled: s.alertsEnabled,
    alertPreference: alertPreferenceByServer.get(s.id) ?? {
      ...DEFAULT_VPS_ALERT_PREFERENCE,
      userId: user.id,
      vpsServerId: s.id,
    },
    telegramAlertsAvailable: Boolean(user.chatId),
    canManageAlerts: isAdmin || s.maintainers.some((maintainer) => maintainer.id === user.id),
    addedById: s.addedById,
    status: !s.approved ? "pending" : (now - s.lastSeen.getTime() > 120_000 ? "offline" : "online"),
    uptime: s.uptime,
    loadAvg: s.loadAvg,
    metrics: {
      cpuUsage: round1(s.cpuUsage),
      ramUsage: round1(s.ramUsage),
      ramTotal: round1(s.ramTotal),
      diskUsage: round1(s.diskUsage),
      diskTotal: round1(s.diskTotal),
      netIn: round2(s.netIn),
      netOut: round2(s.netOut),
    },
    history: {
      week: metricSummary(weekSummaries.get(s.id)),
      month: metricSummary(monthSummaries.get(s.id)),
    },
    lastSeen: s.lastSeen.toISOString(),
  }));

  return NextResponse.json(
    { servers: result },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    name,
    provider,
    ip,
    platform,
    username,
    sshPort,
    password,
    sshKeyFileUrl,
    sshKeyFileName,
    accessPublicKeys,
    tags,
    notes,
    shareWith,
    projectIds,
    maintainerIds,
    planLink,
    duration,
    alertsEnabled,
  } = await req.json();
  const cleanName = String(name ?? "").trim();
  const cleanIp = String(ip ?? "").trim();
  const cleanUsername = String(username ?? "root").trim() || "root";
  const cleanPassword = String(password ?? "").trim();
  const cleanSshKeyFileUrl = String(sshKeyFileUrl ?? "").trim();
  const cleanSshKeyFileName = String(sshKeyFileName ?? "").trim();
  const cleanPlanLink = String(planLink ?? "").trim();
  const linkedProjectIds = Array.isArray(projectIds) ? [...new Set(projectIds.filter((value: unknown): value is string => typeof value === "string"))] : [];
  const linkedMaintainerIds = Array.isArray(maintainerIds) ? [...new Set(maintainerIds.filter((value: unknown): value is string => typeof value === "string"))] : [];

  if (!cleanName || !cleanIp || !cleanUsername || (!cleanPassword && !cleanSshKeyFileUrl)) {
    return NextResponse.json(
      { error: "Name, IP, username, and either password or SSH key file are required" },
      { status: 400 },
    );
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!isAdmin) {
    if (!linkedProjectIds.length) return NextResponse.json({ error: "A developer-submitted server must be linked to one of their projects" }, { status: 400 });
    for (const projectId of linkedProjectIds) {
      if (!await projectAccessFor(user, projectId)) return NextResponse.json({ error: "You can only link servers to your projects" }, { status: 403 });
    }
  }
  if (linkedProjectIds.length) {
    const projectCount = await prisma.project.count({ where: { id: { in: linkedProjectIds }, archivedAt: null } });
    if (projectCount !== linkedProjectIds.length) return NextResponse.json({ error: "One or more projects are invalid" }, { status: 400 });
  }
  if (linkedMaintainerIds.length) {
    const maintainerCount = await prisma.user.count({ where: { id: { in: linkedMaintainerIds }, status: "ACTIVE", roles: { has: "DEV" } } });
    if (maintainerCount !== linkedMaintainerIds.length) return NextResponse.json({ error: "Every maintainer must be an active developer" }, { status: 400 });
  }
  const token = isAdmin ? randomBytes(32).toString("hex") : randomBytes(32).toString("hex");

  const server = await prisma.vpsServer.create({
    data: {
      name: cleanName,
      provider: String(provider ?? "").trim(),
      ip: cleanIp,
      platform: String(platform ?? "").trim(),
      username: cleanUsername,
      sshPort: normalizeSshPort(sshPort),
      password: encryptSecret(cleanPassword),
      sshKeyFileUrl: cleanSshKeyFileUrl ? encryptSecret(cleanSshKeyFileUrl) : null,
      sshKeyFileName: cleanSshKeyFileName || null,
      accessPublicKeys: String(accessPublicKeys ?? "").trim(),
      tags: normalizeTags(tags),
      notes: String(notes ?? "").trim(),
      planLink: cleanPlanLink || null,
      token,
      approved: isAdmin,
      alertsEnabled: isAdmin && alertsEnabled === true,
      addedById: user.id,
      projects: linkedProjectIds.length ? { connect: linkedProjectIds.map((id) => ({ id })) } : undefined,
      maintainers: { connect: [...new Set([user.id, ...linkedMaintainerIds])].map((id) => ({ id })) },
    },
  });

  await logAudit({
    userId: user.id,
    action: "VPS_CREATE",
    entityType: "VpsServer",
    entityId: server.id,
    after: {
      name: server.name,
      ip: server.ip,
      provider: server.provider,
      approved: server.approved,
      alertsEnabled: server.alertsEnabled,
      projectIds: linkedProjectIds,
      maintainerIds: [...new Set([user.id, ...linkedMaintainerIds])],
    },
    userName: user.name,
    request: req,
  });

  if (server.approved) {
    await promptNewVpsMaintainers({
      vpsServerId: server.id,
      serverName: server.name,
      userIds: [...new Set([user.id, ...linkedMaintainerIds])],
      assignedBy: user.name,
    }).catch((error) => console.error("[vps] maintainer alert prompt failed:", error));
  }

  // Mirror secrets into the vault as access-controlled credentials (admin-created
  // servers only; dev-requested servers sync on approval). Pass PLAINTEXT —
  // syncVpsCredentials encrypts the stored credential value itself.
  if (isAdmin) {
    try {
      await syncVpsCredentials(
        { id: server.id, name: server.name, password: cleanPassword, sshKeyFileUrl: cleanSshKeyFileUrl || null },
        user.id,
        user.name,
      );

      // Optional: grant FULL access to selected devs at creation time
      // ("share the entire credentials at the beginning").
      const shareIds: string[] = Array.isArray(shareWith)
        ? shareWith.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
        : [];
      if (shareIds.length) {
        const linked = await prisma.credential.findMany({
          where: { vpsServerId: server.id },
          select: { id: true },
        });
        const now = new Date();
        for (const cred of linked) {
          for (const uid of shareIds) {
            await prisma.credentialAccess.upsert({
              where: { credentialId_userId: { credentialId: cred.id, userId: uid } },
              create: { credentialId: cred.id, userId: uid, accessLevel: "FULL", granted: true, grantedAt: now },
              update: { accessLevel: "FULL", granted: true, grantedAt: now },
            });
          }
        }
        if (linked.length) {
          logCredentialAction({
            action: "SHARE",
            userId: user.id,
            userName: user.name,
            entityId: server.id,
            platform: server.name,
            details: `Full access at creation: ${shareIds.map((u) => u.slice(0, 8)).join(", ")}`,
          });
        }
        for (const uid of shareIds) {
          notify({
            userId: uid,
            type: "CREDENTIAL_ASSIGNED",
            title: "VPS Credentials Shared",
            message: `${user.name} gave you full access to ${server.name}'s credentials.`,
            entityId: server.id,
            priority: "NORMAL",
            actionUrl: "/dev/credentials",
            telegramMessage: formatTgMessage(
              "🔐 VPS Credentials Shared",
              `${server.name}`,
              `Full access by ${user.name}`,
            ),
          }).catch((err) => console.error("[vps] notify failed:", err));
        }
      }
    } catch (e) {
      console.error("[vps] syncVpsCredentials failed:", e);
    }

    // Mirror the plan into Services and create a pending approval request for
    // its first charge. No-op when no priced duration was given.
    try {
      await syncVpsSubscription(
        { id: server.id, name: server.name, planLink: cleanPlanLink },
        duration as VpsDuration | null,
        user.id,
      );
    } catch (e) {
      console.error("[vps] syncVpsSubscription failed:", e);
    }
  }

  // Only return token for admin-created (approved) servers
  return NextResponse.json({
    server: {
      id: server.id,
      name: server.name,
      approved: server.approved,
      ...(isAdmin ? { token } : {}),
    },
  }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const { id, action } = body;
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  if (action === "update") {
    const existingServer = await prisma.vpsServer.findUnique({
      where: { id },
      include: { maintainers: { select: { id: true } } },
    });
    if (!existingServer) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newPassword = String(body.password ?? "").trim();
    const newSshKeyFileUrl = String(body.sshKeyFileUrl ?? "").trim();
    const cleanPlanLink = String(body.planLink ?? "").trim();
    const projectIds: string[] | null = Array.isArray(body.projectIds)
      ? Array.from(new Set<string>(body.projectIds.filter((value: unknown): value is string => typeof value === "string")))
      : null;
    const maintainerIds: string[] | null = Array.isArray(body.maintainerIds)
      ? Array.from(new Set<string>(body.maintainerIds.filter((value: unknown): value is string => typeof value === "string")))
      : null;

    if (projectIds) {
      const validProjects = await prisma.project.count({ where: { id: { in: projectIds }, archivedAt: null } });
      if (validProjects !== projectIds.length) return NextResponse.json({ error: "One or more projects are invalid" }, { status: 400 });
    }
    if (maintainerIds) {
      const validMaintainers = await prisma.user.count({ where: { id: { in: maintainerIds }, status: "ACTIVE", roles: { has: "DEV" } } });
      if (validMaintainers !== maintainerIds.length) return NextResponse.json({ error: "Every maintainer must be an active developer" }, { status: 400 });
    }

    const data: Prisma.VpsServerUpdateInput = {
      name: String(body.name ?? existingServer.name).trim() || existingServer.name,
      provider: String(body.provider ?? "").trim(),
      ip: String(body.ip ?? existingServer.ip).trim(),
      platform: String(body.platform ?? "").trim(),
      username: String(body.username ?? "root").trim() || "root",
      sshPort: normalizeSshPort(body.sshPort),
      accessPublicKeys: String(body.accessPublicKeys ?? "").trim(),
      tags: normalizeTags(body.tags),
      notes: String(body.notes ?? "").trim(),
      planLink: cleanPlanLink || null,
      ...(typeof body.alertsEnabled === "boolean" ? { alertsEnabled: body.alertsEnabled } : {}),
      ...(projectIds ? { projects: { set: projectIds.map((projectId) => ({ id: projectId })) } } : {}),
      ...(maintainerIds ? { maintainers: { set: maintainerIds.map((maintainerId) => ({ id: maintainerId })) } } : {}),
    };
    // Secrets: blank input means "keep existing" (never overwrite with empty).
    if (newPassword) data.password = encryptSecret(newPassword);
    if (newSshKeyFileUrl) data.sshKeyFileUrl = encryptSecret(newSshKeyFileUrl);
    if (body.sshKeyFileName !== undefined) {
      data.sshKeyFileName = String(body.sshKeyFileName ?? "").trim() || null;
    }

    const server = await prisma.vpsServer.update({ where: { id }, data });
    const previousMaintainerIds = existingServer.maintainers.map((maintainer) => maintainer.id);
    const nextMaintainerIds = maintainerIds ?? previousMaintainerIds;
    const newMaintainerIds = nextMaintainerIds.filter((maintainerId) => !previousMaintainerIds.includes(maintainerId));
    const monitoringJustEnabled = !existingServer.alertsEnabled && server.alertsEnabled;
    const promptIds = monitoringJustEnabled ? nextMaintainerIds : newMaintainerIds;
    if (server.approved && promptIds.length) {
      await promptNewVpsMaintainers({
        vpsServerId: server.id,
        serverName: server.name,
        userIds: promptIds,
        assignedBy: user.name,
      }).catch((error) => console.error("[vps] maintainer alert prompt failed:", error));
    }
    if (existingServer.alertsEnabled && !server.alertsEnabled) {
      await prisma.operationalAlert.updateMany({
        where: { vpsServerId: server.id, status: "OPEN" },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }

    // Keep the vault mirror + the Services row in sync (decrypt to plaintext for
    // the credential helper, which re-encrypts).
    try {
      await syncVpsCredentials(
        {
          id: server.id,
          name: server.name,
          password: decryptSecret(server.password),
          sshKeyFileUrl: server.sshKeyFileUrl ? decryptSecret(server.sshKeyFileUrl) : null,
        },
        user.id,
        user.name,
      );
    } catch (e) {
      console.error("[vps] syncVpsCredentials failed:", e);
    }
    try {
      await syncVpsSubscription(
        { id: server.id, name: server.name, planLink: cleanPlanLink },
        body.duration as VpsDuration | null,
        user.id,
      );
    } catch (e) {
      console.error("[vps] syncVpsSubscription failed:", e);
    }

    await logAudit({
      userId: user.id,
      action: "VPS_UPDATE",
      entityType: "VpsServer",
      entityId: id,
      before: { name: existingServer.name, ip: existingServer.ip, provider: existingServer.provider, alertsEnabled: existingServer.alertsEnabled },
      after: { name: server.name, ip: server.ip, provider: server.provider, projectIds, maintainerIds, alertsEnabled: server.alertsEnabled, secretChanged: Boolean(newPassword || newSshKeyFileUrl) },
      userName: user.name,
      request: req,
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "renew") {
    const sub = await prisma.service.findUnique({ where: { vpsServerId: id } });
    if (!sub || sub.price == null || !sub.frequency || sub.frequency === "ONE_TIME" || sub.frequency === "LIFETIME") {
      return NextResponse.json({ error: "No recurring subscription to renew" }, { status: 400 });
    }
    const price = Number(sub.price);
    if (!(price > 0)) return NextResponse.json({ error: "Subscription has no rate" }, { status: 400 });
    const alreadyPending = await prisma.transaction.findFirst({ where: { serviceId: sub.id, status: "PENDING", advancesServiceCycle: true, voidedAt: null }, select: { id: true } });
    if (alreadyPending) return NextResponse.json({ error: "A renewal is already awaiting approval", transactionId: alreadyPending.id }, { status: 409 });
    const result = await recordFinancialEvent({ actorId: user.id, amount: price, currency: sub.currency ?? "INR", method: "OTHER", direction: "OUT", type: "SUBSCRIPTION", description: `VPS plan renewal: ${sub.name}`, date: new Date(), status: "PENDING", service: { action: "LINK", id: sub.id }, advancesServiceCycle: true });
    await logAudit({ userId: user.id, action: "VPS_RENEWAL_APPROVAL_REQUESTED", entityType: "VpsServer", entityId: id, transactionId: result.transaction.id, workflowId: result.workflowId, after: { serviceId: sub.id }, userName: user.name, request: req });
    const symbol = (sub.currency ?? "INR") === "INR" ? "₹" : "$";
    await notifyAdmins({ type: "TX_PENDING", title: "VPS renewal approval required", message: `${sub.name}: approve ${symbol}${price} before the renewal is recorded.`, entityId: result.transaction.id, priority: "HIGH", actionUrl: `/admin/transactions?status=PENDING&transactionId=${result.transaction.id}`, telegramMessage: formatTgMessage("🖥 VPS renewal approval", `${symbol}${price} · ${sub.name}`, "No funds or billing dates change until approval.") });
    return NextResponse.json({ ok: true, pending: true, transactionId: result.transaction.id });
  }

  if (action === "refund") {
    // Credit the rate back to the balance (APPROVED IN) and cancel the plan.
    const sub = await prisma.service.findUnique({ where: { vpsServerId: id } });
    if (!sub || sub.price == null) {
      return NextResponse.json({ error: "No charge to refund" }, { status: 400 });
    }
    const price = Number(sub.price);
    if (!(price > 0)) return NextResponse.json({ error: "Subscription has no rate" }, { status: 400 });

    const original = await prisma.transaction.findFirst({ where: { serviceId: sub.id, direction: "OUT", status: "APPROVED", voidedAt: null, reversals: { none: { voidedAt: null } } }, orderBy: { date: "desc" } });
    if (!original) return NextResponse.json({ error: "No approved active charge to reverse" }, { status: 400 });
    const result = await recordFinancialEvent({ actorId: user.id, amount: price, currency: sub.currency ?? "INR", method: "OTHER", direction: "IN", type: "OTHER", description: `VPS plan refund: ${sub.name}`, date: new Date(), status: "APPROVED", reversalOfId: original.id, service: { action: "LINK", id: sub.id } });
    scheduleFinanceAutomation({ action: "CREATED", actorName: user.name, transactionId: result.transaction.id, sendBackup: true });
    await prisma.service.update({
      where: { id: sub.id },
      data: { status: "CANCELLED", autoRenew: false },
    });
    await logAudit({ userId: user.id, action: "VPS_REFUND", entityType: "VpsServer", entityId: id, transactionId: result.transaction.id, workflowId: result.workflowId, before: { originalTransactionId: original.id }, userName: user.name, request: req });
    return NextResponse.json({ ok: true });
  }

  if (action === "approve") {
    const server = await prisma.vpsServer.update({
      where: { id },
      data: { approved: true },
      include: { maintainers: { select: { id: true } } },
    });
    // Now that it's approved, mirror its secrets into the vault (decrypt the
    // stored columns to plaintext for the sync helper, which re-encrypts).
    try {
      await syncVpsCredentials(
        {
          id: server.id,
          name: server.name,
          password: decryptSecret(server.password),
          sshKeyFileUrl: server.sshKeyFileUrl ? decryptSecret(server.sshKeyFileUrl) : null,
        },
        user.id,
        user.name,
      );
    } catch (e) {
      console.error("[vps] syncVpsCredentials failed:", e);
    }
    await promptNewVpsMaintainers({
      vpsServerId: server.id,
      serverName: server.name,
      userIds: server.maintainers.map((maintainer) => maintainer.id),
      assignedBy: user.name,
    }).catch((error) => console.error("[vps] maintainer alert prompt failed:", error));
    await logAudit({ userId: user.id, action: "VPS_APPROVE", entityType: "VpsServer", entityId: id, before: { approved: false }, after: { approved: true }, userName: user.name, request: req });
    // Return the token so admin can set up the agent
    return NextResponse.json({ server: { id: server.id, name: server.name, token: server.token } });
  }

  if (action === "rotate_token") {
    const token = randomBytes(32).toString("hex");
    const server = await prisma.vpsServer.update({ where: { id }, data: { token }, select: { id: true, name: true } });
    await logAudit({ userId: user.id, action: "VPS_TOKEN_ROTATE", entityType: "VpsServer", entityId: id, after: { rotated: true }, userName: user.name, request: req });
    return NextResponse.json({ server: { ...server, token } }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (action === "reject") {
    const rejected = await prisma.vpsServer.findUnique({ where: { id }, select: { id: true, name: true, addedById: true } });
    await prisma.vpsServer.delete({ where: { id } });
    await logAudit({ userId: user.id, action: "VPS_REJECT", entityType: "VpsServer", entityId: id, before: rejected, userName: user.name, request: req });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  // Reverse any standing plan charge so a deleted server never leaves an orphaned
  // expense behind (mirrors the manual Refund action). Skips already-cancelled subs.
  const sub = await prisma.service.findUnique({ where: { vpsServerId: id } });
  if (sub && sub.status === "ACTIVE" && sub.price != null && Number(sub.price) > 0) {
    const original = await prisma.transaction.findFirst({ where: { serviceId: sub.id, direction: "OUT", status: "APPROVED", voidedAt: null, reversals: { none: { voidedAt: null } } }, orderBy: { date: "desc" } });
    if (original) {
      const result = await recordFinancialEvent({ actorId: user.id, amount: Number(sub.price), currency: sub.currency ?? "INR", method: "OTHER", direction: "IN", type: "OTHER", description: `VPS plan refund (server deleted): ${sub.name}`, date: new Date(), status: "APPROVED", reversalOfId: original.id, service: { action: "LINK", id: sub.id } });
      scheduleFinanceAutomation({ action: "CREATED", actorName: user.name, transactionId: result.transaction.id, sendBackup: true });
      await logAudit({ userId: user.id, action: "VPS_DELETE_REFUND", entityType: "VpsServer", entityId: id, transactionId: result.transaction.id, workflowId: result.workflowId, before: { originalTransactionId: original.id }, userName: user.name, request: req });
    }
    await prisma.service.update({
      where: { id: sub.id },
      data: { status: "CANCELLED", autoRenew: false },
    });
  }

  await prisma.vpsServer.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "VPS_DELETE", entityType: "VpsServer", entityId: id, userName: user.name, request: req });
  return NextResponse.json({ ok: true });
}
