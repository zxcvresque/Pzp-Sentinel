import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auditRequestContext, logAudit } from "@/lib/audit";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";
import { getOpenRouterAccountSnapshot } from "@/lib/openrouter";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "OpenRouter rejected the management key").slice(0, 240);
}

function snapshotWorkspaces(snapshot: Prisma.JsonValue | null) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.workspaces)) return [];
  return snapshot.workspaces.filter((value): value is { id: string; name: string; slug: string } => {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.slug === "string");
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStoreHeaders });
  const { id } = await params;
  const existing = await prisma.apiUsageAccount.findFirst({ where: { id, provider: "OPENROUTER" } });
  if (!existing) return NextResponse.json({ error: "OpenRouter account not found" }, { status: 404, headers: noStoreHeaders });

  const body = await req.json();
  const name = body?.name === undefined ? existing.name : String(body.name).trim();
  const enabled = body?.enabled === undefined ? existing.enabled : body.enabled === true;
  const replacementKey = String(body?.managementKey || "").trim();
  if (!name) return NextResponse.json({ error: "Account name is required" }, { status: 400, headers: noStoreHeaders });

  let nextSnapshot = existing.lastSnapshot;
  let workspaces = snapshotWorkspaces(existing.lastSnapshot);
  if (replacementKey) {
    try {
      nextSnapshot = await getOpenRouterAccountSnapshot(replacementKey) as unknown as Prisma.JsonValue;
      workspaces = snapshotWorkspaces(nextSnapshot);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400, headers: noStoreHeaders });
    }
  }

  const requestedWorkspaceId = body?.workspaceId === undefined
    ? existing.workspaceId
    : body.workspaceId ? String(body.workspaceId).trim() : null;
  if (requestedWorkspaceId && workspaces.length && !workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) {
    return NextResponse.json({ error: "Choose a workspace returned by this management key", workspaces }, { status: 409, headers: noStoreHeaders });
  }
  if (!requestedWorkspaceId && workspaces.length > 1) {
    return NextResponse.json({ error: "Choose the OpenRouter workspace for this account", workspaces }, { status: 409, headers: noStoreHeaders });
  }
  const workspaceId = requestedWorkspaceId || workspaces[0]?.id || null;

  const updated = await prisma.apiUsageAccount.update({
    where: { id },
    data: {
      name,
      enabled,
      workspaceId,
      apiKey: replacementKey ? encryptSecret(replacementKey) : undefined,
      lastSnapshot: replacementKey ? nextSnapshot as Prisma.InputJsonValue : undefined,
      lastFetchedAt: replacementKey ? new Date() : undefined,
      lastError: replacementKey ? null : undefined,
      lastErrorAt: replacementKey ? null : undefined,
    },
  });
  await logAudit({
    userId: user.id,
    userName: user.name,
    request: req,
    action: replacementKey ? "OPENROUTER_ACCOUNT_KEY_ROTATE" : "OPENROUTER_ACCOUNT_UPDATE",
    entityType: "OpenRouterAccount",
    entityId: id,
    before: { name: existing.name, workspaceId: existing.workspaceId, enabled: existing.enabled },
    after: { name: updated.name, workspaceId: updated.workspaceId, enabled: updated.enabled, managementKeyRotated: Boolean(replacementKey) },
  });
  return NextResponse.json({ account: { id: updated.id, name: updated.name, workspaceId: updated.workspaceId, enabled: updated.enabled }, workspaces }, { headers: noStoreHeaders });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStoreHeaders });
  const { id } = await params;
  const existing = await prisma.apiUsageAccount.findFirst({
    where: { id, provider: "OPENROUTER" },
    select: { id: true, name: true, workspaceId: true, enabled: true, _count: { select: { openRouterKeys: true } } },
  });
  if (!existing) return NextResponse.json({ error: "OpenRouter account not found" }, { status: 404, headers: noStoreHeaders });
  const body = await req.json().catch(() => null);
  if (body?.confirmation !== existing.name) {
    return NextResponse.json({ error: `Type ${existing.name} to confirm removal` }, { status: 400, headers: noStoreHeaders });
  }

  const context = auditRequestContext(req);
  await prisma.$transaction(async (db) => {
    await db.apiUsageAccount.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "OPENROUTER_ACCOUNT_DELETE",
        entityType: "OpenRouterAccount",
        entityId: id,
        before: { name: existing.name, workspaceId: existing.workspaceId, enabled: existing.enabled, localKeyCount: existing._count.openRouterKeys },
        after: { removedFromSentinel: true, remoteKeysRevoked: false },
        ...context,
      },
    });
  });
  return NextResponse.json({ removed: true }, { headers: noStoreHeaders });
}
