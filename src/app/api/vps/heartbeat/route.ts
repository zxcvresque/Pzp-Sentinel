import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  await prisma.vpsServer.update({
    where: { id: server.id },
    data: {
      cpuUsage: body.cpu ?? 0,
      ramUsage: body.ram_used ?? 0,
      ramTotal: body.ram_total ?? 0,
      diskUsage: body.disk_used ?? 0,
      diskTotal: body.disk_total ?? 0,
      netIn: body.net_in ?? 0,
      netOut: body.net_out ?? 0,
      uptime: body.uptime ?? 0,
      loadAvg: body.load_avg ?? "",
      ip: body.ip ?? server.ip,
      status: "online",
      lastSeen: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
