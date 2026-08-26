import { createHash } from "node:crypto";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

export interface OpenRouterKeyUsage {
  byok_usage: number;
  byok_usage_daily: number;
  byok_usage_monthly: number;
  byok_usage_weekly: number;
  creator_user_id?: string | null;
  expires_at?: string | null;
  include_byok_in_limit: boolean;
  is_free_tier?: boolean;
  is_management_key?: boolean;
  is_provisioning_key?: boolean;
  label: string;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: "daily" | "weekly" | "monthly" | null;
  rate_limit?: { interval: string; note?: string; requests: number } | null;
  usage: number;
  usage_daily: number;
  usage_monthly: number;
  usage_weekly: number;
  created_at?: string;
  disabled?: boolean;
  hash?: string;
  name?: string;
  updated_at?: string | null;
  workspace_id?: string | null;
}

export interface OpenRouterActivityItem {
  byok_usage_inference: number;
  completion_tokens: number;
  date: string;
  endpoint_id: string;
  model: string;
  model_permaslug: string;
  prompt_tokens: number;
  provider_name: string;
  reasoning_tokens: number;
  requests: number;
  usage: number;
  workspace_id?: string;
}

export interface OpenRouterAccountSnapshot {
  credits: { total_credits: number; total_usage: number; remaining: number };
  keys: OpenRouterKeyUsage[];
  activity: OpenRouterActivityItem[];
}

function safeProviderMessage(value: unknown, status: number) {
  const body = value as { error?: { message?: unknown }; message?: unknown } | null;
  const candidate = body?.error?.message ?? body?.message;
  const message = typeof candidate === "string" ? candidate.slice(0, 240) : `OpenRouter returned HTTP ${status}`;
  return message.replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted-key]");
}

async function openRouterFetch<T>(key: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${OPENROUTER_API}${path}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(safeProviderMessage(payload, response.status));
  return payload as T;
}

export interface CreateOpenRouterKeyInput {
  name: string;
  limit?: number | null;
  limit_reset?: "daily" | "weekly" | "monthly" | null;
  include_byok_in_limit?: boolean;
  workspace_id?: string;
  expires_at?: string | null;
  creator_user_id?: string | null;
}

export async function createOpenRouterApiKey(managementKey: string, input: CreateOpenRouterKeyInput) {
  return openRouterFetch<{ data: OpenRouterKeyUsage; key: string }>(managementKey, "/keys", { method: "POST", body: input });
}

export async function deleteOpenRouterApiKey(managementKey: string, keyHash: string) {
  await openRouterFetch<unknown>(managementKey, `/keys/${encodeURIComponent(keyHash)}`, { method: "DELETE" });
}

export async function updateOpenRouterApiKey(managementKey: string, keyHash: string, input: { name?: string; limit?: number | null; limit_reset?: "daily" | "weekly" | "monthly" | null; include_byok_in_limit?: boolean; disabled?: boolean }) {
  const response = await openRouterFetch<{ data: OpenRouterKeyUsage }>(managementKey, `/keys/${encodeURIComponent(keyHash)}`, { method: "PATCH", body: input });
  return response.data;
}

export function openRouterKeyHash(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export async function getOpenRouterKeyUsage(key: string) {
  const response = await openRouterFetch<{ data: OpenRouterKeyUsage }>(key, "/key");
  return response.data;
}

export async function getOpenRouterActivity(managementKey: string, keyHash?: string) {
  const query = new URLSearchParams();
  if (keyHash) query.set("api_key_hash", keyHash);
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await openRouterFetch<{ data: OpenRouterActivityItem[] }>(managementKey, `/activity${suffix}`);
  return response.data;
}

export async function getOpenRouterAccountSnapshot(managementKey: string): Promise<OpenRouterAccountSnapshot> {
  const [creditResponse, keyResponse, activity] = await Promise.all([
    openRouterFetch<{ data: { total_credits: number; total_usage: number } }>(managementKey, "/credits"),
    openRouterFetch<{ data: OpenRouterKeyUsage[] }>(managementKey, "/keys?include_disabled=true"),
    getOpenRouterActivity(managementKey),
  ]);
  const totalCredits = Number(creditResponse.data.total_credits || 0);
  const totalUsage = Number(creditResponse.data.total_usage || 0);
  return {
    credits: { total_credits: totalCredits, total_usage: totalUsage, remaining: totalCredits - totalUsage },
    keys: keyResponse.data,
    activity,
  };
}
