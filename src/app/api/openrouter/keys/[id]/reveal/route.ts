import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const key = await prisma.openRouterKey.findUnique({
    where: { id },
    select: { id: true, name: true, encryptedKey: true, enabled: true, accesses: { where: { userId: user.id }, select: { id: true } } },
  });
  const allowed = Boolean(key && (hasRole(user.roles, "ADMIN") || key.accesses.length > 0));
  if (!key || !allowed) {
    await logAudit({ userId: user.id, userName: user.name, request: req, action: "OPENROUTER_KEY_ACCESS_DENIED", entityType: "OpenRouterKey", entityId: id, outcome: "FAILURE", errorMessage: "Key not assigned" });
    return NextResponse.json({ error: "Key not found or not assigned to you" }, { status: 404 });
  }
  if (!key.enabled) return NextResponse.json({ error: "This key is disabled in Sentinel" }, { status: 403 });
  await logAudit({ userId: user.id, userName: user.name, request: req, action: "OPENROUTER_KEY_REVEAL", entityType: "OpenRouterKey", entityId: id, after: { name: key.name, access: hasRole(user.roles, "ADMIN") ? "ADMIN" : "ASSIGNED_DEV" } });
  return NextResponse.json({ key: decryptSecret(key.encryptedKey) }, { headers: { "Cache-Control": "private, no-store" } });
}
