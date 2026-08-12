import crypto from "node:crypto";

const OPENCODE_ORIGIN = "https://opencode.ai";
const SERVER_URL = `${OPENCODE_ORIGIN}/_server`;
const SUBSCRIPTION_SERVER_ID =
  "7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4";
const REQUEST_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export type OpenCodeWindowKey = "rolling" | "weekly" | "monthly";

export interface OpenCodeUsageWindow {
  key: OpenCodeWindowKey;
  label: string;
  usedPercent: number;
  resetsAt: string;
}

export interface OpenCodeUsageSnapshot {
  windows: OpenCodeUsageWindow[];
  renewsAt: string | null;
  checkedAt: string;
  source: "dashboard" | "rpc";
}

export class OpenCodeUsageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AUTH_EXPIRED"
      | "NETWORK"
      | "UPSTREAM"
      | "PARSE_ERROR"
      | "INVALID_CONFIG",
  ) {
    super(message);
    this.name = "OpenCodeUsageError";
  }
}

interface WindowValue {
  usedPercent: number;
  resetSeconds: number;
}

const WINDOW_NAMES: Array<{
  key: OpenCodeWindowKey;
  label: string;
  aliases: string[];
}> = [
  { key: "rolling", label: "5h", aliases: ["rollingUsage", "rolling", "rolling_usage"] },
  { key: "weekly", label: "Weekly", aliases: ["weeklyUsage", "weekly", "weekly_usage"] },
  { key: "monthly", label: "Monthly", aliases: ["monthlyUsage", "monthly", "monthly_usage"] },
];

const PERCENT_KEYS = [
  "usagePercent",
  "usedPercent",
  "percentUsed",
  "usage_percent",
  "used_percent",
  "utilizationPercent",
  "utilization_percent",
  "percent",
];
const RESET_SECONDS_KEYS = [
  "resetInSec",
  "resetInSeconds",
  "resetSeconds",
  "reset_in_sec",
  "resetsInSec",
  "resetsInSeconds",
  "resetSec",
];
const RESET_AT_KEYS = ["resetAt", "resetsAt", "reset_at", "nextReset", "next_reset"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function valueForKeys(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function parseResetAt(value: unknown, now: Date): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const numeric = finiteNumber(value);
  const timestamp =
    numeric !== null
      ? numeric > 1_000_000_000_000
        ? numeric
        : numeric > 1_000_000_000
          ? numeric * 1000
          : NaN
      : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((timestamp - now.getTime()) / 1000));
}

function parseWindowObject(record: Record<string, unknown>, now: Date): WindowValue | null {
  let usedPercent = finiteNumber(valueForKeys(record, PERCENT_KEYS));
  if (usedPercent === null) {
    const used = finiteNumber(valueForKeys(record, ["used", "consumed", "count", "usedTokens"]));
    const limit = finiteNumber(valueForKeys(record, ["limit", "total", "quota", "max", "cap"]));
    if (used !== null && limit !== null && limit > 0) usedPercent = (used / limit) * 100;
  }
  if (usedPercent === null) return null;

  let resetSeconds = finiteNumber(valueForKeys(record, RESET_SECONDS_KEYS));
  if (resetSeconds === null) resetSeconds = parseResetAt(valueForKeys(record, RESET_AT_KEYS), now);

  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetSeconds: Math.max(0, Math.round(resetSeconds ?? 0)),
  };
}

function findNamedRecord(root: unknown, aliases: string[], depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findNamedRecord(item, aliases, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(root)) return null;

  for (const alias of aliases) {
    if (isRecord(root[alias])) return root[alias] as Record<string, unknown>;
  }
  for (const value of Object.values(root)) {
    const found = findNamedRecord(value, aliases, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonWindows(text: string, now: Date): Map<OpenCodeWindowKey, WindowValue> | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }

  const windows = new Map<OpenCodeWindowKey, WindowValue>();
  for (const definition of WINDOW_NAMES) {
    const record = findNamedRecord(root, definition.aliases);
    if (!record) continue;
    const parsed = parseWindowObject(record, now);
    if (parsed) windows.set(definition.key, parsed);
  }
  return windows.has("rolling") ? windows : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function propertyNumber(segment: string, keys: string[]): number | null {
  for (const key of keys) {
    const match = segment.match(new RegExp(`${escapeRegex(key)}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (match) return finiteNumber(match[1]);
  }
  return null;
}

function parseHydrationWindow(text: string, aliases: string[]): WindowValue | null {
  for (const alias of aliases) {
    const startMatch = new RegExp(`${escapeRegex(alias)}\\s*:`, "i").exec(text);
    if (!startMatch) continue;
    const start = startMatch.index;
    let end = Math.min(text.length, start + 1600);
    for (const other of WINDOW_NAMES.flatMap((item) => item.aliases)) {
      if (other === alias) continue;
      const match = new RegExp(`${escapeRegex(other)}\\s*:`, "ig");
      match.lastIndex = start + startMatch[0].length;
      const next = match.exec(text);
      if (next && next.index < end) end = next.index;
    }
    const segment = text.slice(start, end);
    const usedPercent = propertyNumber(segment, PERCENT_KEYS);
    if (usedPercent === null) continue;
    const resetSeconds = propertyNumber(segment, RESET_SECONDS_KEYS) ?? 0;
    return {
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      resetSeconds: Math.max(0, Math.round(resetSeconds)),
    };
  }
  return null;
}

function findRenewal(text: string): string | null {
  const match = text.match(/renew(?:s)?(?:At|_at)\s*:\s*["']([^"']+)["']/i);
  if (!match) return null;
  const timestamp = Date.parse(match[1]);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseOpenCodeUsage(
  text: string,
  now: Date = new Date(),
): Omit<OpenCodeUsageSnapshot, "source"> {
  const parsedJson = parseJsonWindows(text, now);
  const values = parsedJson ?? new Map<OpenCodeWindowKey, WindowValue>();

  if (!parsedJson) {
    for (const definition of WINDOW_NAMES) {
      const parsed = parseHydrationWindow(text, definition.aliases);
      if (parsed) values.set(definition.key, parsed);
    }
  }

  if (!values.has("rolling")) {
    throw new OpenCodeUsageError(
      "OpenCode returned a page, but its Go usage fields could not be read.",
      "PARSE_ERROR",
    );
  }

  const windows = WINDOW_NAMES.flatMap((definition) => {
    const value = values.get(definition.key);
    if (!value) return [];
    return [{
      key: definition.key,
      label: definition.label,
      usedPercent: value.usedPercent,
      resetsAt: new Date(now.getTime() + value.resetSeconds * 1000).toISOString(),
    } satisfies OpenCodeUsageWindow];
  });

  return {
    windows,
    renewsAt: findRenewal(text),
    checkedAt: now.toISOString(),
  };
}

export function normalizeWorkspaceId(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/(?:^|\/)(wrk_[A-Za-z0-9]+)(?:\/|$|[?#])/i) ?? trimmed.match(/^(wrk_[A-Za-z0-9]+)$/i);
  return match?.[1] ?? null;
}

export function normalizeAuthCookie(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new OpenCodeUsageError("The OpenCode auth cookie is missing or invalid.", "INVALID_CONFIG");
  }
  const authMatch = trimmed.match(/(?:^|;\s*)auth=([^;]+)/i);
  const cookie = authMatch ? `auth=${authMatch[1].trim()}` : `auth=${trimmed}`;
  if (cookie.length > 16_384) {
    throw new OpenCodeUsageError("The OpenCode auth cookie is unexpectedly large.", "INVALID_CONFIG");
  }
  return cookie;
}

function looksSignedOut(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("auth/authorize") ||
    lower.includes("not associated with an account") ||
    lower.includes('actor of type "public"') ||
    lower.includes("sign in to opencode")
  );
}

async function fetchText(
  url: string,
  init: RequestInit,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new OpenCodeUsageError("OpenCode session expired; copy a fresh auth cookie.", "AUTH_EXPIRED");
    }
    const text = await response.text();
    if (response.status === 401 || response.status === 403 || looksSignedOut(text)) {
      throw new OpenCodeUsageError("OpenCode session expired; copy a fresh auth cookie.", "AUTH_EXPIRED");
    }
    if (!response.ok) {
      throw new OpenCodeUsageError(`OpenCode returned HTTP ${response.status}.`, "UPSTREAM");
    }
    return text;
  } catch (error) {
    if (error instanceof OpenCodeUsageError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "OpenCode did not respond before the 12 second timeout."
      : "Could not reach OpenCode.";
    throw new OpenCodeUsageError(message, "NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDashboard(workspaceId: string, cookie: string): Promise<string> {
  return fetchText(`${OPENCODE_ORIGIN}/workspace/${workspaceId}/go`, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: cookie,
      "User-Agent": USER_AGENT,
    },
  });
}

async function fetchSubscriptionRpc(
  workspaceId: string,
  cookie: string,
  method: "GET" | "POST",
): Promise<string> {
  const args = JSON.stringify([workspaceId]);
  const url = method === "GET"
    ? `${SERVER_URL}?${new URLSearchParams({ id: SUBSCRIPTION_SERVER_ID, args })}`
    : SERVER_URL;
  return fetchText(url, {
    method,
    headers: {
      Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
      Cookie: cookie,
      Origin: OPENCODE_ORIGIN,
      Referer: `${OPENCODE_ORIGIN}/workspace/${workspaceId}/go`,
      "User-Agent": USER_AGENT,
      "X-Server-Id": SUBSCRIPTION_SERVER_ID,
      "X-Server-Instance": `server-fn:${crypto.randomUUID()}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? args : undefined,
  });
}

export async function fetchOpenCodeGoUsage(input: {
  workspaceId: string;
  authCookie: string;
  now?: Date;
}): Promise<OpenCodeUsageSnapshot> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  if (!workspaceId) {
    throw new OpenCodeUsageError("Use a wrk_… workspace ID or full OpenCode workspace URL.", "INVALID_CONFIG");
  }
  const cookie = normalizeAuthCookie(input.authCookie);
  let pageError: unknown;

  try {
    const page = await fetchDashboard(workspaceId, cookie);
    return { ...parseOpenCodeUsage(page, input.now), source: "dashboard" };
  } catch (error) {
    pageError = error;
    if (error instanceof OpenCodeUsageError && error.code === "AUTH_EXPIRED") throw error;
  }

  for (const method of ["GET", "POST"] as const) {
    try {
      const response = await fetchSubscriptionRpc(workspaceId, cookie, method);
      return { ...parseOpenCodeUsage(response, input.now), source: "rpc" };
    } catch (error) {
      if (error instanceof OpenCodeUsageError && error.code === "AUTH_EXPIRED") throw error;
    }
  }

  throw pageError instanceof OpenCodeUsageError
    ? pageError
    : new OpenCodeUsageError("OpenCode usage is temporarily unavailable.", "UPSTREAM");
}

export async function validateOpenCodeGoApiKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) return;
  const text = await fetchText(`${OPENCODE_ORIGIN}/zen/go/v1/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  try {
    const parsed = JSON.parse(text) as { data?: unknown[] };
    if (!Array.isArray(parsed.data)) throw new Error();
  } catch {
    throw new OpenCodeUsageError("The API key validation response was not recognized.", "PARSE_ERROR");
  }
}
