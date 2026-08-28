import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createShareCode, isShareEntityType, shareBotUrl, shareTargetPath, type ShareEntityType } from "@/lib/share-links";

const noStore = { "Cache-Control": "private, no-store" };

async function entityExists(entityType: ShareEntityType, entityId: string) {
  switch (entityType) {
    case "audit": return Boolean(await prisma.auditLog.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "transaction": return Boolean(await prisma.transaction.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "service": return Boolean(await prisma.service.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "credential": return Boolean(await prisma.credential.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } }));
    case "openrouter-account": return Boolean(await prisma.apiUsageAccount.findFirst({ where: { id: entityId, provider: "OPENROUTER" }, select: { id: true } }));
    case "openrouter-key": return Boolean(await prisma.openRouterKey.findUnique({ where: { id: entityId }, select: { id: true } }));
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
  const body = await req.json().catch(() => null);
  const entityType = body?.entityType;
  const entityId = typeof body?.entityId === "string" ? body.entityId.trim() : "";
  if (!isShareEntityType(entityType) || !entityId) return NextResponse.json({ error: "Unsupported share target" }, { status: 400, headers: noStore });
  if (!await entityExists(entityType, entityId)) return NextResponse.json({ error: "Share target not found" }, { status: 404, headers: noStore });

  const title = String(body?.title || entityType.replaceAll("-", " ")).replace(/\s+/g, " ").trim().slice(0, 120);
  const details = String(body?.details || "").replace(/\s+/g, " ").trim().slice(0, 180) || null;
  const targetPath = shareTargetPath(entityType, entityId);
  const existing = await prisma.shareLink.findUnique({ where: { entityType_entityId: { entityType, entityId } }, select: { id: true, code: true } });
  const shareLink = existing
    ? await prisma.shareLink.update({ where: { id: existing.id }, data: { targetPath, title, details, createdById: user.id } })
    : await prisma.shareLink.create({ data: { code: createShareCode(), entityType, entityId, targetPath, title, details, createdById: user.id } });

  await logAudit({ userId: user.id, userName: user.name, request: req, action: existing ? "SHARE_LINK_REFRESH" : "SHARE_LINK_CREATE", entityType: "ShareLink", entityId: shareLink.id, after: { code: shareLink.code, sharedEntityType: entityType, sharedEntityId: entityId, targetPath } });
  return NextResponse.json({ shortUrl: shareBotUrl(shareLink.code) }, { headers: noStore });
}
