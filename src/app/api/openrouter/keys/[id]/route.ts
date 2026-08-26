import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";
import { deleteOpenRouterApiKey, updateOpenRouterApiKey } from "@/lib/openrouter";
import { formatTgMessage, notify } from "@/lib/notifications";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.openRouterKey.findUnique({ where: { id }, include: { accesses: true, account: { select: { apiKey: true } } } });
  if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  const body = await req.json();
  const name = body?.name === undefined ? existing.name : String(body.name).trim();
  const previousSnapshot = existing.lastSnapshot && typeof existing.lastSnapshot === "object" && !Array.isArray(existing.lastSnapshot)
    ? existing.lastSnapshot as Record<string, unknown>
    : {};
  const enabled = body?.enabled === undefined ? existing.enabled && previousSnapshot.disabled !== true : body.enabled === true;
  const previousLimitReset = ["daily", "weekly", "monthly"].includes(String(previousSnapshot.limit_reset))
    ? previousSnapshot.limit_reset as "daily" | "weekly" | "monthly"
    : null;
  const limitReset = body?.limitReset === undefined
    ? previousLimitReset
    : body.limitReset === "" || body.limitReset == null
      ? null
      : ["daily", "weekly", "monthly"].includes(body.limitReset)
        ? body.limitReset as "daily" | "weekly" | "monthly"
        : undefined;
  const includeByokInLimit = body?.includeByokInLimit === undefined
    ? previousSnapshot.include_byok_in_limit === true
    : body.includeByokInLimit === true;
  const configuredLimit = body?.configuredLimit === undefined
    ? existing.configuredLimit
    : body.configuredLimit === "" || body.configuredLimit == null ? null : Number(body.configuredLimit);
  if (!name) return NextResponse.json({ error: "Key name is required" }, { status: 400 });
  if (configuredLimit != null && (!Number.isFinite(Number(configuredLimit)) || Number(configuredLimit) < 0)) return NextResponse.json({ error: "Limit must be zero or greater" }, { status: 400 });
  if (limitReset === undefined) return NextResponse.json({ error: "Limit reset must be daily, weekly, monthly, or never" }, { status: 400 });
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
  const limitResetChanged = limitReset !== previousLimitReset;
  const includeByokChanged = includeByokInLimit !== (previousSnapshot.include_byok_in_limit === true);
  const enabledChanged = enabled !== existing.enabled || (previousSnapshot.disabled === true) === enabled;
  const providerControlsChanged = nameChanged || limitChanged || limitResetChanged || includeByokChanged || enabledChanged;
  let providerSnapshot: unknown = existing.lastSnapshot;
  if (providerControlsChanged) {
    if (!existing.account.apiKey || !existing.keyHash) return NextResponse.json({ error: "This key cannot be updated at OpenRouter because its management link is unavailable" }, { status: 409 });
    try {
      providerSnapshot = await updateOpenRouterApiKey(decryptSecret(existing.account.apiKey), existing.keyHash, {
        ...(nameChanged ? { name } : {}),
        ...(limitChanged ? { limit: nextLimit } : {}),
        ...(limitResetChanged ? { limit_reset: limitReset } : {}),
        ...(includeByokChanged ? { include_byok_in_limit: includeByokInLimit } : {}),
        ...(enabledChanged ? { disabled: !enabled } : {}),
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
  await logAudit({ userId: user.id, userName: user.name, request: req, action: "OPENROUTER_KEY_UPDATE", entityType: "OpenRouterKey", entityId: id, before: { name: existing.name, enabled: existing.enabled, configuredLimit: previousLimit, limitReset: previousLimitReset, includeByokInLimit: previousSnapshot.include_byok_in_limit === true, assigneeIds: existing.accesses.map((access) => access.userId) }, after: { name, enabled, configuredLimit: configuredLimit?.toString() ?? null, limitReset, includeByokInLimit, assigneeIds } });
  const previousAssignees = new Set(existing.accesses.map((access) => access.userId));
  const newlyAssigned = assigneeIds.filter((userId) => !previousAssignees.has(userId));
  const limitText = configuredLimit == null ? "No spending limit" : `$${Number(configuredLimit).toFixed(2)} spending limit`;
  await Promise.allSettled(newlyAssigned.map((userId) => notify({
    userId,
    type: "CREDENTIAL_ASSIGNED",
    title: "OpenRouter API key assigned",
    message: `${name} is ready in Services → OpenRouter. ${limitText}.`,
    entityId: `openrouter:${id}`,
    priority: "HIGH",
    actionUrl: `/dev/openrouter?keyId=${encodeURIComponent(id)}&shared=${encodeURIComponent(`openrouter-key:${id}`)}#shared-${encodeURIComponent(id)}`,
    actionLabel: "View API key",
    inAppOverride: true,
    telegramOverride: true,
    telegramMessage: formatTgMessage("🔐 OpenRouter key assigned", name, `${limitText}\nOpen Sentinel to view usage or reveal the assigned key.`),
  })));
  return NextResponse.json({ key: { id: updated.id, name: updated.name, enabled: updated.enabled } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.openRouterKey.findUnique({
    where: { id },
    include: { accesses: true, account: { select: { apiKey: true, name: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body?.confirmation !== existing.name) {
    return NextResponse.json({ error: `Type ${existing.name} to confirm permanent revocation` }, { status: 400 });
  }
  if (!existing.account.apiKey || !existing.keyHash) {
    return NextResponse.json({ error: "This key cannot be revoked because its OpenRouter management link is unavailable" }, { status: 409 });
  }
  try {
    await deleteOpenRouterApiKey(decryptSecret(existing.account.apiKey), existing.keyHash);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OpenRouter rejected the key revocation" }, { status: 400 });
  }
  await prisma.openRouterKey.delete({ where: { id } });
  await logAudit({
    userId: user.id,
    userName: user.name,
    request: req,
    action: "OPENROUTER_KEY_REVOKE",
    entityType: "OpenRouterKey",
    entityId: id,
    before: { name: existing.name, accountName: existing.account.name, assigneeIds: existing.accesses.map((access) => access.userId), keyHash: existing.keyHash },
    after: { revokedAtOpenRouter: true, removedFromSentinel: true },
  });
  await Promise.allSettled(existing.accesses.map((access) => notify({
    userId: access.userId,
    type: "SYSTEM",
    title: "OpenRouter API key revoked",
    message: `${existing.name} was revoked and is no longer available in Sentinel.`,
    entityId: `openrouter:${id}`,
    priority: "HIGH",
    actionUrl: "/dev/openrouter",
    actionLabel: "View OpenRouter keys",
    inAppOverride: true,
    telegramOverride: true,
    telegramMessage: formatTgMessage("🔒 OpenRouter key revoked", existing.name, "The key is no longer available in Sentinel."),
  })));
  return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "private, no-store" } });
}
