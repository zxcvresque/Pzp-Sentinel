import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

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

  const now = Date.now();
  const result = servers.map((s) => ({
    id: s.id,
    name: s.name,
    provider: s.provider,
    ip: s.ip,
    specs: s.specs,
    approved: s.approved,
    addedById: s.addedById,
    status: !s.approved ? "pending" : (now - s.lastSeen.getTime() > 120_000 ? "offline" : "online"),
    uptime: s.uptime,
    loadAvg: s.loadAvg,
    metrics: {
      cpuUsage: Math.round(s.cpuUsage * 10) / 10,
      ramUsage: Math.round(s.ramUsage * 10) / 10,
      ramTotal: Math.round(s.ramTotal * 10) / 10,
      diskUsage: Math.round(s.diskUsage * 10) / 10,
      diskTotal: Math.round(s.diskTotal * 10) / 10,
      netIn: Math.round(s.netIn * 100) / 100,
      netOut: Math.round(s.netOut * 100) / 100,
    },
    lastSeen: s.lastSeen.toISOString(),
  }));

  return NextResponse.json({ servers: result });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, provider, ip } = await req.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const token = isAdmin ? randomBytes(32).toString("hex") : randomBytes(32).toString("hex");

  const server = await prisma.vpsServer.create({
    data: {
      name,
      provider: provider || "",
      ip: ip || "",
      token,
      approved: isAdmin,
      addedById: user.id,
    },
  });

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
