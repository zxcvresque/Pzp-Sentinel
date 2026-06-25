import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  return NextResponse.json({ ok: true });
}
