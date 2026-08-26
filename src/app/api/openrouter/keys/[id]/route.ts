import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";
import { updateOpenRouterApiKey } from "@/lib/openrouter";
import { formatTgMessage, notify } from "@/lib/notifications";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.openRouterKey.findUnique({ where: { id }, include: { accesses: true, account: { select: { apiKey: true } } } });
  if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  const body = await req.json();
  const name = body?.name === undefined ? existing.name : String(body.name).trim();
  const enabled = body?.enabled === undefined ? existing.enabled : body.enabled === true;
  const configuredLimit = body?.configuredLimit === undefined
    ? existing.configuredLimit
    : body.configuredLimit === "" || body.configuredLimit == null ? null : Number(body.configuredLimit);
  if (!name) return NextResponse.json({ error: "Key name is required" }, { status: 400 });
  if (configuredLimit != null && (!Number.isFinite(Number(configuredLimit)) || Number(configuredLimit) < 0)) return NextResponse.json({ error: "Limit must be zero or greater" }, { status: 400 });
  const assigneeIds = body?.assigneeIds === undefined
    ? existing.accesses.map((access) => access.userId)
    : [...new Set(Array.isArray(body.assigneeIds) ? body.assigneeIds.filter((value: unknown) => typeof value === "string") : [])] as string[];
  if (assigneeIds.length) {
    const valid = await prisma.user.count({ where: { id: { in: assigneeIds }, status: "ACTIVE", roles: { has: "DEV" } } });
    if (valid !== assigneeIds.length) return NextResponse.json({ error: "Keys can only be assigned to active developers" }, { status: 400 });
  }
  const previousLimit = existing.configuredLimit?.toString() ?? null;
  const nextLimit = configuredLimit == null ? null : Number(configuredLimit);
  const nameChanged = name !== existing.name;
  const limitChanged = (nextLimit == null ? null : String(nextLimit)) !== (previousLimit == null ? null : String(Number(previousLimit)));
  const providerControlsChanged = nameChanged || limitChanged;
  let providerSnapshot: unknown = existing.lastSnapshot;
  if (providerControlsChanged) {
    if (!existing.account.apiKey || !existing.keyHash) return NextResponse.json({ error: "This key cannot be updated at OpenRouter because its management link is unavailable" }, { status: 409 });
    try {
      providerSnapshot = await updateOpenRouterApiKey(decryptSecret(existing.account.apiKey), existing.keyHash, {
        ...(nameChanged ? { name } : {}),
        ...(limitChanged ? { limit: nextLimit } : {}),
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "OpenRouter rejected the limit update" }, { status: 400 });
    }
  }
  const updated = await prisma.$transaction(async (db) => {
    await db.openRouterKeyAccess.deleteMany({ where: { keyId: id } });
    return db.openRouterKey.update({
      where: { id },
      data: {
        name,
        enabled,
        configuredLimit: configuredLimit == null ? null : new Prisma.Decimal(configuredLimit),
        lastSnapshot: providerControlsChanged ? providerSnapshot as Prisma.InputJsonValue : undefined,
        lastFetchedAt: providerControlsChanged ? new Date() : undefined,
        accesses: assigneeIds.length ? { create: assigneeIds.map((userId) => ({ userId })) } : undefined,
      },
    });
  });
  await logAudit({ userId: user.id, userName: user.name, request: req, action: "OPENROUTER_KEY_UPDATE", entityType: "OpenRouterKey", entityId: id, before: { name: existing.name, enabled: existing.enabled, assigneeIds: existing.accesses.map((access) => access.userId) }, after: { name, enabled, configuredLimit: configuredLimit?.toString() ?? null, assigneeIds } });
  const previousAssignees = new Set(existing.accesses.map((access) => access.userId));
  const newlyAssigned = assigneeIds.filter((userId) => !previousAssignees.has(userId));
  const limitText = configuredLimit == null ? "No spending limit" : `$${Number(configuredLimit).toFixed(2)} spending limit`;
  await Promise.allSettled(newlyAssigned.map((userId) => notify({
    userId,
    type: "CREDENTIAL_ASSIGNED",
    title: "OpenRouter API key assigned",
    message: `${name} is ready in Services → OpenRouter. ${limitText}.`,
    entityId: id,
    priority: "HIGH",
    actionUrl: "/dev/openrouter",
    actionLabel: "View API key",
    inAppOverride: true,
    telegramOverride: true,
    telegramMessage: formatTgMessage("🔐 OpenRouter key assigned", name, `${limitText}\nOpen Sentinel to view usage or reveal the assigned key.`),
  })));
  return NextResponse.json({ key: { id: updated.id, name: updated.name, enabled: updated.enabled } }, { headers: { "Cache-Control": "private, no-store" } });
}
