import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { formatTgMessage, notify } from "@/lib/notifications";
import {
  getOpenRouterAccountSnapshot,
  getOpenRouterActivity,
  getOpenRouterKeyUsage,
  createOpenRouterApiKey,
  deleteOpenRouterApiKey,
  getOpenRouterWorkspaces,
  openRouterKeyHash,
} from "@/lib/openrouter";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const assigneeSelect = { id: true, name: true, photoUrl: true, telegramUser: true } as const;

function jsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "OpenRouter sync failed").slice(0, 240);
}

async function refreshAccount(account: { id: string; apiKey: string | null }) {
  if (!account.apiKey) return;
  try {
    const snapshot = await getOpenRouterAccountSnapshot(decryptSecret(account.apiKey));
    await prisma.apiUsageAccount.update({
      where: { id: account.id },
      data: { lastSnapshot: jsonValue(snapshot), lastFetchedAt: new Date(), lastError: null, lastErrorAt: null },
    });
  } catch (error) {
    await prisma.apiUsageAccount.update({
      where: { id: account.id },
      data: { lastError: errorMessage(error), lastErrorAt: new Date() },
    });
  }
}

async function refreshStoredKey(key: { id: string; encryptedKey: string; keyHash: string | null; account: { apiKey: string | null } }) {
  try {
    const [snapshot, activity] = await Promise.all([
      getOpenRouterKeyUsage(decryptSecret(key.encryptedKey)),
      key.account.apiKey && key.keyHash
        ? getOpenRouterActivity(decryptSecret(key.account.apiKey), key.keyHash)
        : Promise.resolve(null),
    ]);
    await prisma.openRouterKey.update({
      where: { id: key.id },
      data: {
        lastSnapshot: jsonValue(snapshot),
        activitySnapshot: activity ? jsonValue(activity) : undefined,
        lastFetchedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });
  } catch (error) {
    await prisma.openRouterKey.update({
      where: { id: key.id },
      data: { lastError: errorMessage(error), lastErrorAt: new Date() },
    });
  }
}

function safeKey(key: {
  id: string;
  accountId: string;
  name: string;
  keyHash: string | null;
  configuredLimit: Prisma.Decimal | null;
  enabled: boolean;
  lastSnapshot: Prisma.JsonValue | null;
  activitySnapshot: Prisma.JsonValue | null;
  lastFetchedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  accesses: Array<{ user: typeof assigneeSelect extends never ? never : { id: string; name: string; photoUrl: string | null; telegramUser: string } }>;
}) {
  return {
    id: key.id,
    accountId: key.accountId,
    name: key.name,
    keyHash: key.keyHash,
    maskedKey: key.lastSnapshot && typeof key.lastSnapshot === "object" && !Array.isArray(key.lastSnapshot) && "label" in key.lastSnapshot
      ? String(key.lastSnapshot.label)
      : "sk-or-••••••••",
    configuredLimit: key.configuredLimit?.toString() ?? null,
    enabled: key.enabled,
    usage: key.lastSnapshot,
    activity: key.activitySnapshot,
    assignees: key.accesses.map((access) => access.user),
    lastFetchedAt: key.lastFetchedAt,
    lastError: key.lastError,
    lastErrorAt: key.lastErrorAt,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DEV"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const isAdmin = hasRole(user.roles, "ADMIN");
  const shouldRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (shouldRefresh) {
    if (isAdmin) {
      const accounts = await prisma.apiUsageAccount.findMany({ where: { provider: "OPENROUTER", enabled: true }, select: { id: true, apiKey: true } });
      const keys = await prisma.openRouterKey.findMany({ where: { enabled: true, account: { enabled: true } }, select: { id: true, encryptedKey: true, keyHash: true, account: { select: { apiKey: true } } } });
      await Promise.allSettled([...accounts.map(refreshAccount), ...keys.map(refreshStoredKey)]);
    } else {
      const keys = await prisma.openRouterKey.findMany({
        where: { enabled: true, account: { enabled: true }, accesses: { some: { userId: user.id } } },
        select: { id: true, encryptedKey: true, keyHash: true, account: { select: { apiKey: true } } },
      });
      await Promise.allSettled(keys.map(refreshStoredKey));
    }
  }

  if (isAdmin) {
    const accounts = await prisma.apiUsageAccount.findMany({
      where: { provider: "OPENROUTER" },
      orderBy: { createdAt: "asc" },
      include: { openRouterKeys: { include: { accesses: { include: { user: { select: assigneeSelect } } } }, orderBy: { createdAt: "asc" } } },
    });
    return NextResponse.json({
      role: "ADMIN",
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        workspaceId: account.workspaceId,
        enabled: account.enabled,
        hasManagementKey: Boolean(account.apiKey),
        snapshot: account.lastSnapshot,
        lastFetchedAt: account.lastFetchedAt,
        lastError: account.lastError,
        lastErrorAt: account.lastErrorAt,
        keys: account.openRouterKeys.map(safeKey),
      })),
    }, { headers: noStoreHeaders });
  }

  const keys = await prisma.openRouterKey.findMany({
    where: { enabled: true, accesses: { some: { userId: user.id } } },
    include: {
      account: { select: { id: true, name: true } },
      accesses: { where: { userId: user.id }, include: { user: { select: assigneeSelect } } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    role: "DEV",
    keys: keys.map((key) => ({ ...safeKey(key), account: key.account })),
  }, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const mode = body?.mode === "KEY" ? "KEY" : body?.mode === "WORKSPACES" ? "WORKSPACES" : "ACCOUNT";

  if (mode === "WORKSPACES") {
    const managementKey = String(body?.managementKey || "").trim();
    if (!managementKey) return NextResponse.json({ error: "Management key is required" }, { status: 400, headers: noStoreHeaders });
    try {
      const workspaces = await getOpenRouterWorkspaces(managementKey);
      return NextResponse.json({ workspaces }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400, headers: noStoreHeaders });
    }
  }

  if (mode === "ACCOUNT") {
    const name = String(body?.name || "").trim();
    const managementKey = String(body?.managementKey || "").trim();
    if (!name || !managementKey) return NextResponse.json({ error: "Account name and management key are required" }, { status: 400 });
    let snapshot;
    try {
      snapshot = await getOpenRouterAccountSnapshot(managementKey);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
    }
    const requestedWorkspaceId = body?.workspaceId ? String(body.workspaceId).trim() : "";
    if (requestedWorkspaceId && !snapshot.workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) {
      return NextResponse.json({ error: "Choose a workspace returned by this management key", workspaces: snapshot.workspaces }, { status: 400, headers: noStoreHeaders });
    }
    if (!requestedWorkspaceId && snapshot.workspaces.length > 1) {
      return NextResponse.json({ error: "Choose the OpenRouter workspace to connect", requiresWorkspaceSelection: true, workspaces: snapshot.workspaces }, { status: 409, headers: noStoreHeaders });
    }
    const workspaceId = requestedWorkspaceId || snapshot.workspaces[0]?.id || null;
    const account = await prisma.apiUsageAccount.create({
      data: {
        provider: "OPENROUTER",
        name,
        workspaceId,
        authCookie: null,
        apiKey: encryptSecret(managementKey),
        lastSnapshot: jsonValue(snapshot),
        lastFetchedAt: new Date(),
      },
    });
    await logAudit({ userId: user.id, userName: user.name, request: req, action: "OPENROUTER_ACCOUNT_CREATE", entityType: "OpenRouterAccount", entityId: account.id, after: { name, workspaceId: account.workspaceId } });
    return NextResponse.json({ account: { id: account.id, name: account.name } }, { status: 201, headers: noStoreHeaders });
  }

  const accountId = String(body?.accountId || "");
  const name = String(body?.name || "").trim();
  const createRemotely = body?.source === "CREATE";
  let plaintextKey = String(body?.key || "").trim();
  const assigneeIds = Array.isArray(body?.assigneeIds) ? [...new Set(body.assigneeIds.filter((id: unknown) => typeof id === "string"))] as string[] : [];
  const configuredLimit = body?.configuredLimit === "" || body?.configuredLimit == null ? null : Number(body.configuredLimit);
  if (!accountId || !name || (!createRemotely && !plaintextKey)) return NextResponse.json({ error: createRemotely ? "Account and key name are required" : "Account, key name, and API key are required" }, { status: 400 });
  if (configuredLimit != null && (!Number.isFinite(configuredLimit) || configuredLimit < 0)) return NextResponse.json({ error: "Limit must be zero or greater" }, { status: 400 });
  const account = await prisma.apiUsageAccount.findFirst({ where: { id: accountId, provider: "OPENROUTER" }, select: { id: true, apiKey: true, workspaceId: true, lastSnapshot: true } });
  if (!account) return NextResponse.json({ error: "OpenRouter account not found" }, { status: 404 });
  if (assigneeIds.length) {
    const validAssignees = await prisma.user.count({ where: { id: { in: assigneeIds }, status: "ACTIVE", roles: { has: "DEV" } } });
    if (validAssignees !== assigneeIds.length) return NextResponse.json({ error: "Keys can only be assigned to active developers" }, { status: 400 });
  }

  let usage;
  let activity = null;
  let remoteCreatedHash: string | null = null;
  let keyHash = "";
  try {
    if (createRemotely) {
      if (!account.apiKey) return NextResponse.json({ error: "A management key is required to create OpenRouter keys" }, { status: 400 });
      const reset = ["daily", "weekly", "monthly"].includes(body?.limitReset) ? body.limitReset as "daily" | "weekly" | "monthly" : null;
      const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: "Expiry must be a valid date" }, { status: 400 });
      const requestedWorkspaceId = body?.workspaceId ? String(body.workspaceId).trim() : account.workspaceId;
      const snapshot = account.lastSnapshot && typeof account.lastSnapshot === "object" && !Array.isArray(account.lastSnapshot) ? account.lastSnapshot as Record<string, unknown> : null;
      const workspaces = Array.isArray(snapshot?.workspaces) ? snapshot.workspaces as Array<Record<string, unknown>> : [];
      if (requestedWorkspaceId && workspaces.length && !workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) {
        return NextResponse.json({ error: "Choose a workspace available to this management key" }, { status: 400 });
      }
      const created = await createOpenRouterApiKey(decryptSecret(account.apiKey), {
        name,
        limit: configuredLimit,
        limit_reset: reset,
        include_byok_in_limit: body?.includeByokInLimit === true,
        ...(requestedWorkspaceId ? { workspace_id: requestedWorkspaceId } : {}),
        ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
        ...(body?.creatorUserId ? { creator_user_id: String(body.creatorUserId).trim() } : {}),
      });
      plaintextKey = created.key;
      usage = created.data;
      keyHash = created.data.hash || openRouterKeyHash(plaintextKey);
      remoteCreatedHash = keyHash;
    } else {
      keyHash = openRouterKeyHash(plaintextKey);
      usage = await getOpenRouterKeyUsage(plaintextKey);
    }
    if (account.apiKey) activity = await getOpenRouterActivity(decryptSecret(account.apiKey), keyHash);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
  let key;
  try {
    key = await prisma.openRouterKey.create({
      data: {
        accountId,
        name,
        encryptedKey: encryptSecret(plaintextKey),
        keyHash,
        configuredLimit: configuredLimit == null ? null : new Prisma.Decimal(configuredLimit),
        lastSnapshot: jsonValue(usage),
        activitySnapshot: activity ? jsonValue(activity) : undefined,
        lastFetchedAt: new Date(),
        accesses: assigneeIds.length ? { create: assigneeIds.map((userId) => ({ userId })) } : undefined,
      },
    });
  } catch {
    if (remoteCreatedHash && account.apiKey) {
      await deleteOpenRouterApiKey(decryptSecret(account.apiKey), remoteCreatedHash).catch(() => undefined);
    }
    return NextResponse.json({ error: "The key could not be stored securely. A newly-created remote key was rolled back." }, { status: 500 });
  }
  await logAudit({ userId: user.id, userName: user.name, request: req, action: createRemotely ? "OPENROUTER_KEY_PROVISION" : "OPENROUTER_KEY_CREATE", entityType: "OpenRouterKey", entityId: key.id, after: { accountId, name, configuredLimit, assigneeIds, source: createRemotely ? "OPENROUTER_MANAGEMENT_API" : "IMPORTED" } });
  const limitText = configuredLimit == null ? "No spending limit" : `$${configuredLimit.toFixed(2)} spending limit${createRemotely && body?.limitReset ? ` · ${body.limitReset} reset` : ""}`;
  await Promise.allSettled(assigneeIds.map((userId) => notify({
    userId,
    type: "CREDENTIAL_ASSIGNED",
    title: "OpenRouter API key assigned",
    message: `${name} is ready in Services → OpenRouter. ${limitText}.`,
    entityId: `openrouter:${key.id}`,
    priority: "HIGH",
    actionUrl: `/dev/openrouter?keyId=${encodeURIComponent(key.id)}&shared=${encodeURIComponent(`openrouter-key:${key.id}`)}#shared-${encodeURIComponent(key.id)}`,
    actionLabel: "View API key",
    inAppOverride: true,
    telegramOverride: true,
    telegramMessage: formatTgMessage("🔐 OpenRouter key assigned", name, `${limitText}\nOpen Sentinel to view usage or reveal the assigned key.`),
  })));
  return NextResponse.json({ key: { id: key.id, name: key.name } }, { status: 201, headers: noStoreHeaders });
}
