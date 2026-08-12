import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";
import {
  fetchOpenCodeGoUsage,
  type OpenCodeUsageSnapshot,
} from "@/lib/opencode-go-usage";

const REFRESH_INTERVAL_MS = 30_000;

type StoredAccount = Awaited<ReturnType<typeof findAccounts>>[number];

export interface PublicApiUsageAccount {
  id: string;
  provider: "OPENCODE_GO";
  name: string;
  workspaceId: string;
  expiresAt: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  hasAuthCookie: boolean;
  status: "live" | "stale" | "error" | "disabled" | "pending";
  snapshot: OpenCodeUsageSnapshot | null;
  error: string | null;
  lastFetchedAt: string | null;
}

const globalForUsage = globalThis as unknown as {
  apiUsageInflight?: Map<string, Promise<void>>;
};
const inflight = globalForUsage.apiUsageInflight ?? new Map<string, Promise<void>>();
if (process.env.NODE_ENV !== "production") globalForUsage.apiUsageInflight = inflight;

function findAccounts() {
  return prisma.apiUsageAccount.findMany({ orderBy: { createdAt: "asc" } });
}

function isSnapshot(value: unknown): value is OpenCodeUsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpenCodeUsageSnapshot>;
  return (
    Array.isArray(candidate.windows) &&
    typeof candidate.checkedAt === "string" &&
    (candidate.source === "dashboard" || candidate.source === "rpc")
  );
}

function toPublic(account: StoredAccount): PublicApiUsageAccount {
  const snapshot = isSnapshot(account.lastSnapshot) ? account.lastSnapshot : null;
  const newerError = Boolean(
    account.lastError &&
      account.lastErrorAt &&
      (!account.lastFetchedAt || account.lastErrorAt > account.lastFetchedAt),
  );
  const status: PublicApiUsageAccount["status"] = !account.enabled
    ? "disabled"
    : snapshot && newerError
      ? "stale"
      : snapshot
        ? "live"
        : account.lastError
          ? "error"
          : "pending";

  return {
    id: account.id,
    provider: "OPENCODE_GO",
    name: account.name,
    workspaceId: account.workspaceId,
    expiresAt: account.expiresAt?.toISOString() ?? null,
    enabled: account.enabled,
    hasApiKey: Boolean(account.apiKey),
    hasAuthCookie: Boolean(account.authCookie),
    status,
    snapshot,
    error: status === "stale" || status === "error" ? account.lastError : null,
    lastFetchedAt: account.lastFetchedAt?.toISOString() ?? null,
  };
}

async function performRefresh(account: StoredAccount): Promise<void> {
  try {
    const snapshot = await fetchOpenCodeGoUsage({
      workspaceId: account.workspaceId,
      authCookie: decryptSecret(account.authCookie),
    });
    await prisma.apiUsageAccount.update({
      where: { id: account.id },
      data: {
        lastSnapshot: JSON.parse(JSON.stringify(snapshot)),
        lastFetchedAt: new Date(snapshot.checkedAt),
        lastError: null,
        lastErrorAt: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenCode usage refresh failed.";
    await prisma.apiUsageAccount.update({
      where: { id: account.id },
      data: { lastError: message.slice(0, 500), lastErrorAt: new Date() },
    });
  }
}

async function refreshOne(account: StoredAccount, force: boolean): Promise<void> {
  if (!account.enabled) return;
  const hasNewerError = Boolean(
    account.lastErrorAt &&
      (!account.lastFetchedAt || account.lastErrorAt > account.lastFetchedAt),
  );
  const cacheIsFresh = Boolean(
    account.lastFetchedAt &&
      Date.now() - account.lastFetchedAt.getTime() < REFRESH_INTERVAL_MS,
  );
  if (!force && cacheIsFresh && !hasNewerError) return;

  const existing = inflight.get(account.id);
  if (existing) return existing;
  const request = performRefresh(account).finally(() => inflight.delete(account.id));
  inflight.set(account.id, request);
  return request;
}

export async function listApiUsageAccounts(force = false): Promise<PublicApiUsageAccount[]> {
  const accounts = await findAccounts();
  await Promise.all(accounts.map((account) => refreshOne(account, force)));
  const refreshed = await findAccounts();
  return refreshed.map(toPublic);
}

export async function refreshApiUsageAccount(id: string): Promise<PublicApiUsageAccount | null> {
  const account = await prisma.apiUsageAccount.findUnique({ where: { id } });
  if (!account) return null;
  await refreshOne(account, true);
  const refreshed = await prisma.apiUsageAccount.findUnique({ where: { id } });
  return refreshed ? toPublic(refreshed) : null;
}

export async function getPublicApiUsageAccount(id: string): Promise<PublicApiUsageAccount | null> {
  const account = await prisma.apiUsageAccount.findUnique({ where: { id } });
  return account ? toPublic(account) : null;
}
