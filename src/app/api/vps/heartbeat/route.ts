import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyVpsAlertSubscribers } from "@/lib/vps-alerts";

function numberFromBody(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseLoadAverage(value: unknown) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()));

  return {
    load1: Number.isFinite(parts[0]) ? parts[0] : 0,
    load5: Number.isFinite(parts[1]) ? parts[1] : 0,
    load15: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}

function processHealth(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      name: String(row.name ?? "unknown").slice(0, 100),
      status: String(row.status ?? "unknown").slice(0, 30),
      restarts: Math.max(0, Math.round(numberFromBody(row.restarts))),
      cpu: Math.max(0, numberFromBody(row.cpu)),
      memory: Math.max(0, numberFromBody(row.memory)),
      uptime: Math.max(0, Math.round(numberFromBody(row.uptime))),
    };
  });
}

async function syncMetricAlert(server: { id: string; name: string; alertsEnabled: boolean }, kind: string, title: string, message: string, active: boolean) {
  const fingerprint = `vps:${server.id}:${kind}`;
  const existing = await prisma.operationalAlert.findUnique({ where: { fingerprint } });
  if (!active || !server.alertsEnabled) {
    if (existing?.status === "OPEN") await prisma.operationalAlert.update({ where: { id: existing.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    return;
  }
  const shouldNotify = !existing || existing.status !== "OPEN";
  await prisma.operationalAlert.upsert({
    where: { fingerprint },
    create: { fingerprint, kind, severity: "HIGH", title, message, vpsServerId: server.id },
    update: { status: "OPEN", resolvedAt: null, title, message, severity: "HIGH" },
  });
  if (shouldNotify) {
    await notifyVpsAlertSubscribers({ vpsServerId: server.id, kind, title, message });
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }
  const token = auth.slice(7);

  const server = await prisma.vpsServer.findUnique({ where: { token } });
  if (!server) {
    return NextResponse.json({ error: "Unknown server" }, { status: 403 });
  }

  if (!server.approved) {
    return NextResponse.json({ error: "Server not approved" }, { status: 403 });
  }

  const body = await req.json();
  const load = parseLoadAverage(body.load_avg);
  const snapshot = {
    cpuUsage: numberFromBody(body.cpu),
    ramUsage: numberFromBody(body.ram_used),
    ramTotal: numberFromBody(body.ram_total),
    diskUsage: numberFromBody(body.disk_used),
    diskTotal: numberFromBody(body.disk_total),
    netIn: numberFromBody(body.net_in),
    netOut: numberFromBody(body.net_out),
    uptime: Math.round(numberFromBody(body.uptime)),
    load1: load.load1,
    load5: load.load5,
    load15: load.load15,
  };
  const now = new Date();
  const processes = processHealth(body.processes);
  const releaseVersion = typeof body.release_version === "string" ? body.release_version.trim().slice(0, 120) || null : null;

  await prisma.$transaction([
    prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        cpuUsage: snapshot.cpuUsage,
        ramUsage: snapshot.ramUsage,
        ramTotal: snapshot.ramTotal,
        diskUsage: snapshot.diskUsage,
        diskTotal: snapshot.diskTotal,
        netIn: snapshot.netIn,
        netOut: snapshot.netOut,
        uptime: snapshot.uptime,
        loadAvg: body.load_avg ?? "",
        ip: server.ip || body.ip || "",
        status: "online",
        lastSeen: now,
        processHealth: processes,
        releaseVersion,
      },
    }),
    prisma.vpsMetric.create({
      data: {
        serverId: server.id,
        ...snapshot,
        createdAt: now,
      },
    }),
    prisma.vpsMetric.deleteMany({
      where: {
        serverId: server.id,
        createdAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const ramPct = snapshot.ramTotal > 0 ? snapshot.ramUsage / snapshot.ramTotal * 100 : 0;
  const diskPct = snapshot.diskTotal > 0 ? snapshot.diskUsage / snapshot.diskTotal * 100 : 0;
  await Promise.all([
    syncMetricAlert(server, "VPS_CPU_HIGH", `${server.name}: CPU usage high`, `CPU is ${snapshot.cpuUsage.toFixed(1)}%`, snapshot.cpuUsage >= 90),
    syncMetricAlert(server, "VPS_RAM_HIGH", `${server.name}: memory usage high`, `RAM is ${ramPct.toFixed(1)}%`, ramPct >= 90),
    syncMetricAlert(server, "VPS_DISK_HIGH", `${server.name}: disk usage high`, `Disk is ${diskPct.toFixed(1)}%`, diskPct >= 90),
    syncMetricAlert(server, "VPS_LOAD_HIGH", `${server.name}: load average high`, `1-minute load average is ${snapshot.load1.toFixed(2)}`, snapshot.load1 >= 5),
    syncMetricAlert(server, "VPS_PROCESS_DOWN", `${server.name}: process unhealthy`, processes.filter((process) => process.status !== "online").map((process) => `${process.name}: ${process.status}`).join(", ") || "All reported processes are online", processes.some((process) => process.status !== "online")),
  ]);

  return NextResponse.json({ ok: true });
}
