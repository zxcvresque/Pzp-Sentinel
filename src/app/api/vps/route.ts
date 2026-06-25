import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { syncVpsCredentials } from "@/lib/vps-credentials";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import { notify, formatTgMessage } from "@/lib/notifications";
import { logCredentialAction } from "@/lib/github-log";

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

async function metricSummary(serverId: string, since: Date) {
  const [aggregate, samples] = await Promise.all([
    prisma.vpsMetric.aggregate({
      where: { serverId, createdAt: { gte: since } },
      _avg: {
        cpuUsage: true,
        ramUsage: true,
        ramTotal: true,
        diskUsage: true,
        diskTotal: true,
        load1: true,
        load5: true,
        load15: true,
      },
    }),
    prisma.vpsMetric.count({
      where: { serverId, createdAt: { gte: since } },
    }),
  ]);

  const ramUsage = aggregate._avg.ramUsage ?? 0;
  const ramTotal = aggregate._avg.ramTotal ?? 0;
  const diskUsage = aggregate._avg.diskUsage ?? 0;
  const diskTotal = aggregate._avg.diskTotal ?? 0;

  return {
    samples,
    cpuUsage: round1(aggregate._avg.cpuUsage ?? 0),
    ramUsage: round1(ramUsage),
    ramTotal: round1(ramTotal),
    ramPct: round1(pct(ramUsage, ramTotal)),
    diskUsage: round1(diskUsage),
    diskTotal: round1(diskTotal),
    diskPct: round1(pct(diskUsage, diskTotal)),
    load1: round2(aggregate._avg.load1 ?? 0),
    load5: round2(aggregate._avg.load5 ?? 0),
    load15: round2(aggregate._avg.load15 ?? 0),
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
    where: isAdmin ? {} : { approved: true },
    orderBy: { createdAt: "asc" },
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

  const now = Date.now();
  const result = await Promise.all(servers.map(async (s) => ({
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
    ...(isAdmin
      ? {
          password: decryptSecret(s.password),
          sshKeyFileUrl: s.sshKeyFileUrl ? decryptSecret(s.sshKeyFileUrl) : null,
          accessPublicKeys: s.accessPublicKeys,
        }
      : {}),
    ...(isAdmin
      ? {}
      : { access: accessByServer.get(s.id) ?? { status: "none", accessLevel: null, devPublicKey: null } }),
    specs: s.specs,
    approved: s.approved,
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
      week: await metricSummary(s.id, new Date(now - WEEK_MS)),
      month: await metricSummary(s.id, new Date(now - MONTH_MS)),
    },
    lastSeen: s.lastSeen.toISOString(),
  })));

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
  } = await req.json();
  const cleanName = String(name ?? "").trim();
  const cleanIp = String(ip ?? "").trim();
  const cleanUsername = String(username ?? "root").trim() || "root";
  const cleanPassword = String(password ?? "").trim();
  const cleanSshKeyFileUrl = String(sshKeyFileUrl ?? "").trim();
  const cleanSshKeyFileName = String(sshKeyFileName ?? "").trim();

  if (!cleanName || !cleanIp || !cleanUsername || (!cleanPassword && !cleanSshKeyFileUrl)) {
    return NextResponse.json(
      { error: "Name, IP, username, and either password or SSH key file are required" },
      { status: 400 },
    );
  }

  const isAdmin = hasRole(user.roles, "ADMIN");
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
      token,
      approved: isAdmin,
      addedById: user.id,
    },
  });

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
            actionUrl: "/credentials",
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

  const { id, action } = await req.json();
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  if (action === "approve") {
    const server = await prisma.vpsServer.update({
      where: { id },
      data: { approved: true },
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
    // Return the token so admin can set up the agent
    return NextResponse.json({ server: { id: server.id, name: server.name, token: server.token } });
  }

  if (action === "reject") {
    await prisma.vpsServer.delete({ where: { id } });
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

  await prisma.vpsServer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
