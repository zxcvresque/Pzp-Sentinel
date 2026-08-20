import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";
import { logAudit } from "@/lib/audit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user || !hasRole(user.roles, "ADMIN")) {
    if (user) await logAudit({ userId: user.id, userName: user.name, action: "VPS_SECRET_ACCESS_DENIED", entityType: "VpsServer", entityId: id, request, outcome: "FAILURE", errorMessage: "Admin access required" });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const field = body?.field === "PRIVATE_KEY" ? "PRIVATE_KEY" : body?.field === "PASSWORD" ? "PASSWORD" : null;
  const purpose = body?.purpose === "COPY" ? "COPY" : "REVEAL";
  if (!field) return NextResponse.json({ error: "Select PASSWORD or PRIVATE_KEY" }, { status: 400 });

  const server = await prisma.vpsServer.findUnique({
    where: { id },
    select: { id: true, name: true, password: true, sshKeyFileUrl: true },
  });
  if (!server) {
    await logAudit({ userId: user.id, userName: user.name, action: "VPS_SECRET_ACCESS_DENIED", entityType: "VpsServer", entityId: id, request, outcome: "FAILURE", errorMessage: "Server not found" });
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }
  const encrypted = field === "PASSWORD" ? server.password : server.sshKeyFileUrl;
  if (!encrypted) return NextResponse.json({ error: "This secret is not configured" }, { status: 404 });

  await logAudit({
    userId: user.id,
    action: `VPS_SECRET_${purpose}`,
    entityType: "VpsServer",
    entityId: id,
    after: { field },
    userName: user.name,
    request,
  });

  return NextResponse.json({ value: decryptSecret(encrypted) }, { headers: { "Cache-Control": "private, no-store" } });
}
