"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ShareButton from "@/components/ShareButton";
import ServicesNav from "@/components/ServicesNav";

type Developer = { id: string; name: string; photoUrl: string | null; telegramUser: string };
type Usage = Record<string, unknown> & {
  usage?: number; usage_daily?: number; usage_weekly?: number; usage_monthly?: number;
  byok_usage?: number; byok_usage_daily?: number; byok_usage_weekly?: number; byok_usage_monthly?: number;
  limit?: number | null; limit_remaining?: number | null; limit_reset?: string | null; label?: string;
};
type Activity = {
  byok_usage_inference: number; completion_tokens: number; date: string; endpoint_id: string;
  model: string; model_permaslug: string; prompt_tokens: number; provider_name: string;
  reasoning_tokens: number; requests: number; usage: number; workspace_id?: string;
};
type TrackedKey = {
  id: string; accountId: string; name: string; keyHash: string | null; maskedKey: string;
  configuredLimit: string | null; enabled: boolean; usage: Usage | null; activity: Activity[] | null;
  assignees: Developer[]; lastFetchedAt: string | null; lastError: string | null; createdAt: string;
  account?: { id: string; name: string };
};
type AccountSnapshot = {
  credits?: { total_credits: number; total_usage: number; remaining: number };
  keys?: Usage[];
  activity?: Activity[];
};
type Account = {
  id: string; name: string; workspaceId: string | null; enabled: boolean; hasManagementKey: boolean;
  snapshot: AccountSnapshot | null; lastFetchedAt: string | null; lastError: string | null; keys: TrackedKey[];
};

const money = (value: unknown) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const compact = (value: unknown) => Number(value || 0).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";

function Progress({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
  return <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-gradient-to-r from-lime via-cyan to-violet transition-all duration-700" style={{ width: limit ? `${pct}%` : "0%" }} /></div>;
}

function Metric({ label, value, accent = false }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return <div className={`rounded-xl border p-3 ${accent ? "border-lime/20 bg-lime/[.045]" : "border-[var(--border)] bg-bg-deep/60"}`}><p className="font-mono text-[8px] uppercase tracking-[.14em] text-text-tertiary">{label}</p><p className={`mt-1.5 break-words text-sm font-bold ${accent ? "text-lime" : "text-text-primary"}`}>{value}</p></div>;
}

function DetailGrid({ value }: { value: Usage }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(value).map(([key, raw]) => <Metric key={key} label={key.replaceAll("_", " ")} value={raw == null ? "—" : typeof raw === "object" ? JSON.stringify(raw) : typeof raw === "boolean" ? raw ? "Yes" : "No" : String(raw)} />)}</div>;
}

function ActivityTable({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-text-tertiary">No activity was returned for the last 30 completed UTC days.</div>;
  return <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-white/[.025] font-mono text-[8px] uppercase tracking-[.12em] text-text-tertiary"><tr><th className="p-3">Date / endpoint</th><th className="p-3">Model</th><th className="p-3">Provider</th><th className="p-3 text-right">Requests</th><th className="p-3 text-right">Prompt</th><th className="p-3 text-right">Completion</th><th className="p-3 text-right">Reasoning</th><th className="p-3 text-right">Usage</th><th className="p-3 text-right">BYOK</th></tr></thead><tbody>{activity.map((row, index) => <tr key={`${row.date}-${row.endpoint_id}-${index}`} className="border-t border-[var(--border)]"><td className="p-3"><b>{row.date}</b><small className="mt-1 block font-mono text-[8px] text-text-tertiary">{row.endpoint_id}</small></td><td className="p-3"><b>{row.model}</b><small className="mt-1 block text-text-tertiary">{row.model_permaslug}</small></td><td className="p-3">{row.provider_name}{row.workspace_id && <small className="mt-1 block text-text-tertiary">{row.workspace_id}</small>}</td><td className="p-3 text-right">{compact(row.requests)}</td><td className="p-3 text-right">{compact(row.prompt_tokens)}</td><td className="p-3 text-right">{compact(row.completion_tokens)}</td><td className="p-3 text-right">{compact(row.reasoning_tokens)}</td><td className="p-3 text-right font-bold text-lime">{money(row.usage)}</td><td className="p-3 text-right">{money(row.byok_usage_inference)}</td></tr>)}</tbody></table></div>;
}

function AssigneePicker({ developers, selected, onChange }: { developers: Developer[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2">{developers.map((dev) => { const active = selected.includes(dev.id); return <button key={dev.id} type="button" onClick={() => onChange(active ? selected.filter((id) => id !== dev.id) : [...selected, dev.id])} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${active ? "border-lime/30 bg-lime/[.06]" : "border-[var(--border)] bg-bg-deep"}`}><span className={`grid h-5 w-5 place-items-center rounded-md border text-[10px] ${active ? "border-lime bg-lime text-bg-void" : "border-[var(--border)]"}`}>{active ? "✓" : ""}</span><span><b className="block text-xs">{dev.name}</b><small className="text-[10px] text-text-tertiary">@{dev.telegramUser}</small></span></button>; })}</div>;
}

function KeyCard({ keyItem, role, developers, reload }: { keyItem: TrackedKey; role: "ADMIN" | "DEV"; developers: Developer[]; reload: (refresh?: boolean) => Promise<void> }) {
  const usage = keyItem.usage || {};
  const providerLimit = typeof usage.limit === "number" ? usage.limit : null;
  const displayedLimit = keyItem.configuredLimit != null ? Number(keyItem.configuredLimit) : providerLimit;
  const used = Number(usage.usage || 0);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(keyItem.name);
  const [editLimit, setEditLimit] = useState(keyItem.configuredLimit ?? (typeof usage.limit === "number" ? String(usage.limit) : ""));
  const [editAssignees, setEditAssignees] = useState(keyItem.assignees.map((dev) => dev.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reveal(copy = false) {
    if (revealed && !copy) { setRevealed(null); return; }
    setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/keys/${keyItem.id}/reveal`, { method: "POST", cache: "no-store" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || "Unable to reveal key"); return; }
    setRevealed(data.key);
    if (copy) await navigator.clipboard.writeText(data.key);
  }

  async function saveAccess() {
    setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/keys/${keyItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName, configuredLimit: editLimit, assigneeIds: editAssignees }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || "Unable to update key"); return; }
    setEditing(false); await reload(false);
  }

  return <article data-share-target={`openrouter-key:${keyItem.id}`} className="card overflow-hidden border-lime/10">
    <div className="border-b border-[var(--border)] bg-gradient-to-br from-lime/[.06] via-transparent to-violet/[.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-extrabold">{keyItem.name}</h3><span className={`rounded-full px-2 py-1 font-mono text-[8px] uppercase ${keyItem.enabled ? "bg-mint/10 text-mint" : "bg-coral/10 text-coral"}`}>{keyItem.enabled ? "Live" : "Disabled"}</span>{usage.limit_reset && <span className="rounded-full bg-violet/10 px-2 py-1 font-mono text-[8px] uppercase text-violet">{String(usage.limit_reset)} reset</span>}</div><p className="mt-1 font-mono text-[10px] text-text-tertiary">{keyItem.maskedKey} · synced {stamp(keyItem.lastFetchedAt)}</p></div><div className="flex flex-wrap gap-2">{role === "ADMIN" && <ShareButton entityType="openrouter-key" entityId={keyItem.id} />}<button onClick={() => reveal(false)} disabled={busy} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-lime">{busy ? "Checking…" : revealed ? "Hide key" : "Reveal key"}</button><button onClick={() => reveal(true)} disabled={busy} className="rounded-full bg-lime px-3 py-1.5 text-xs font-semibold text-bg-void">Copy key</button>{role === "ADMIN" && <button onClick={() => setEditing(!editing)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary">Access</button>}</div></div>
      {revealed && <div className="mt-4 break-all rounded-xl border border-amber/20 bg-amber/[.04] p-3 font-mono text-xs text-amber">{revealed}</div>}
      {error && <p className="mt-3 text-xs text-coral">{error}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Lifetime spend</p><div className="mt-1 flex items-end justify-between gap-3"><strong className="font-display text-4xl text-lime">{money(used)}</strong><span className="text-xs text-text-tertiary">{displayedLimit == null ? "No configured ceiling" : `${money(Math.max(0, displayedLimit - used))} remaining`}</span></div><div className="mt-3"><Progress used={used} limit={displayedLimit} /></div></div><div className="grid grid-cols-2 gap-2"><Metric label="Today" value={money(usage.usage_daily)} accent /><Metric label="This week" value={money(usage.usage_weekly)} /><Metric label="This month" value={money(usage.usage_monthly)} /><Metric label="Limit" value={displayedLimit == null ? "Unlimited" : money(displayedLimit)} /></div></div>
    </div>
    {editing && <div className="border-b border-[var(--border)] bg-violet/[.025] p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-tertiary">Sentinel key name<input value={editName} onChange={(event) => setEditName(event.target.value)} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">Local warning limit (USD)<input type="number" min="0" step="0.01" value={editLimit} onChange={(event) => setEditLimit(event.target.value)} className="input mt-1.5" /></label></div><p className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Only selected developers can see usage or reveal this key</p><AssigneePicker developers={developers} selected={editAssignees} onChange={setEditAssignees} /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(false)} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs">Cancel</button><button disabled={busy} onClick={saveAccess} className="rounded-full bg-lime px-4 py-2 text-xs font-bold text-bg-void">{busy ? "Saving…" : "Save access"}</button></div></div>}
    <div className="space-y-5 p-5 sm:p-6"><div><div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-bold">Every field returned by OpenRouter</h4><span className="font-mono text-[8px] uppercase text-text-tertiary">Live key endpoint</span></div><DetailGrid value={usage} /></div><details className="group"><summary className="cursor-pointer list-none rounded-xl border border-[var(--border)] bg-white/[.015] p-3 text-xs font-bold">30-day model & provider activity <span className="float-right text-text-tertiary group-open:rotate-180">⌄</span></summary><div className="pt-3"><ActivityTable activity={keyItem.activity || []} /></div></details>{keyItem.assignees.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[8px] uppercase text-text-tertiary">Assigned</span>{keyItem.assignees.map((dev) => <span key={dev.id} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px]">{dev.name}</span>)}</div>}</div>
  </article>;
}

export default function OpenRouterUsage({ role }: { role: "ADMIN" | "DEV" }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [devKeys, setDevKeys] = useState<TrackedKey[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "Primary OpenRouter", managementKey: "", workspaceId: "" });
  const [keyAccountId, setKeyAccountId] = useState<string | null>(null);
  const [keyForm, setKeyForm] = useState({ source: "CREATE" as "CREATE" | "IMPORT", name: "", key: "", configuredLimit: "", limitReset: "monthly", includeByokInLimit: true, workspaceId: "", expiresAt: "", creatorUserId: "", assigneeIds: [] as string[] });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); setError("");
    try {
      const response = await fetch(`/api/openrouter${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load OpenRouter usage");
      setAccounts(data.accounts || []); setDevKeys(data.keys || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load OpenRouter usage"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(true), 0); if (role === "ADMIN") fetch("/api/developers").then((response) => response.json()).then((data) => setDevelopers((data.developers || []).filter((dev: Developer) => dev.id))); return () => window.clearTimeout(timer); }, [load, role]);
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 120_000); return () => window.clearInterval(timer); }, [load]);

  const devSummary = useMemo(() => ({ spend: devKeys.reduce((sum, key) => sum + Number(key.usage?.usage || 0), 0), month: devKeys.reduce((sum, key) => sum + Number(key.usage?.usage_monthly || 0), 0) }), [devKeys]);

  async function addAccount(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/openrouter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ACCOUNT", ...accountForm }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to add account"); return; }
    setShowAccountForm(false); setAccountForm({ name: "Primary OpenRouter", managementKey: "", workspaceId: "" }); await load(false);
  }

  async function addKey(event: React.FormEvent) {
    event.preventDefault(); if (!keyAccountId) return; setSaving(true); setError("");
    const response = await fetch("/api/openrouter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "KEY", accountId: keyAccountId, ...keyForm }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to add key"); return; }
    setKeyAccountId(null); setKeyForm({ source: "CREATE", name: "", key: "", configuredLimit: "", limitReset: "monthly", includeByokInLimit: true, workspaceId: "", expiresAt: "", creatorUserId: "", assigneeIds: [] }); await load(false);
  }

  if (loading) return <div><ServicesNav role={role} /><div className="grid gap-4"><div className="skeleton h-44" /><div className="skeleton h-80" /></div></div>;
  const keys = role === "DEV" ? devKeys : [];

  return <div className="mx-auto max-w-[1500px]"><ServicesNav role={role} />
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-lime">OpenRouter · live accounting</p><h1 className="mt-1 text-3xl font-extrabold">Usage <span className="font-display text-lime">control room</span></h1><p className="mt-2 max-w-2xl text-sm text-text-tertiary">Account credits, per-key limits, BYOK spend, and 30-day model activity. Secrets are encrypted at rest and revealed only through an audited action.</p></div><div className="flex gap-2"><button onClick={() => load(true)} disabled={refreshing} className="rounded-full border border-[var(--border)] px-4 py-2.5 text-xs font-bold text-text-secondary">{refreshing ? "Syncing OpenRouter…" : "Sync now"}</button>{role === "ADMIN" && <button onClick={() => setShowAccountForm(!showAccountForm)} className="rounded-full bg-lime px-4 py-2.5 text-xs font-bold text-bg-void">Add account</button>}</div></div>
    {error && <div className="mb-4 rounded-xl border border-coral/20 bg-coral/[.05] p-4 text-sm text-coral">{error}</div>}
    {showAccountForm && <form onSubmit={addAccount} className="card mb-6 overflow-hidden border-lime/15 bg-gradient-to-br from-lime/[.035] via-bg-card to-violet/[.025]"><div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-lime/20 bg-lime/[.07] text-lime"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span><div><h2 className="text-base font-bold text-text-primary">Connect an OpenRouter account</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-text-tertiary">Your Management API key is validated on the server, encrypted with AES-256-GCM, and never returned by account endpoints.</p></div></div><button type="button" onClick={() => setShowAccountForm(false)} className="self-start rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-text-tertiary transition hover:border-[var(--border-hover)] hover:text-text-primary">Close</button></div><div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[.9fr_1.35fr_1fr]"><label className="grid min-w-0 gap-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">Account name</span><input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} className="input" placeholder="Primary OpenRouter" /></label><label className="grid min-w-0 gap-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">Management API key</span><input required type="password" autoComplete="off" value={accountForm.managementKey} onChange={(event) => setAccountForm({ ...accountForm, managementKey: event.target.value })} className="input font-mono" placeholder="Paste management key" /><small className="text-[10px] leading-4 text-text-tertiary">Used only for account sync and key provisioning.</small></label><label className="grid min-w-0 gap-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">Workspace ID <i className="font-sans font-normal normal-case tracking-normal text-text-tertiary">optional</i></span><input value={accountForm.workspaceId} onChange={(event) => setAccountForm({ ...accountForm, workspaceId: event.target.value })} className="input font-mono" placeholder="Default workspace" /></label></div><div className="flex flex-col gap-3 border-t border-[var(--border)] bg-black/[.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="flex items-center gap-2 text-[10px] text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-mint" />Encrypted before it is written to the database</p><button disabled={saving || !accountForm.name.trim() || !accountForm.managementKey.trim()} className="inline-flex min-h-10 items-center justify-center rounded-full bg-lime px-5 py-2 text-sm font-bold text-bg-void shadow-[0_8px_28px_rgba(111,209,215,.12)] transition hover:-translate-y-px hover:bg-lime/90 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Validating securely…" : "Connect account"}</button></div></form>}

    {role === "DEV" && <><section className="mb-6 overflow-hidden rounded-2xl border border-lime/20 bg-gradient-to-br from-lime/[.09] via-bg-card to-violet/[.05] p-6"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-lime">Your assigned OpenRouter envelope</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><strong className="font-display text-4xl text-lime">{money(devSummary.spend)}</strong><small className="mt-1 block text-text-tertiary">Lifetime across {devKeys.length} assigned key{devKeys.length === 1 ? "" : "s"}</small></div><Metric label="This month" value={money(devSummary.month)} /><Metric label="Visibility" value="Assigned keys only" /></div></section>{keys.length ? <div className="space-y-5">{keys.map((key) => <KeyCard key={key.id} keyItem={key} role={role} developers={[]} reload={load} />)}</div> : <div className="card p-10 text-center"><h2 className="font-bold">No OpenRouter keys assigned</h2><p className="mt-2 text-sm text-text-tertiary">An admin can assign a key without exposing any other account data.</p></div>}</>}

    {role === "ADMIN" && (accounts.length ? <div className="space-y-8">{accounts.map((account) => { const credits = account.snapshot?.credits; const activity = account.snapshot?.activity || []; const totalRequests = activity.reduce((sum, row) => sum + Number(row.requests || 0), 0); const totalTokens = activity.reduce((sum, row) => sum + Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0) + Number(row.reasoning_tokens || 0), 0); return <section key={account.id} data-share-target={`openrouter-account:${account.id}`} className="space-y-5"><div className="overflow-hidden rounded-2xl border border-lime/25 bg-gradient-to-br from-lime/[.11] via-bg-card to-violet/[.07] p-6 shadow-[0_24px_90px_rgba(111,209,215,.06)]"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[9px] uppercase tracking-[.16em] text-lime">Account-level usage · always visible</p><h2 className="mt-1 text-2xl font-extrabold">{account.name}</h2><p className="mt-1 text-xs text-text-tertiary">Management sync {stamp(account.lastFetchedAt)}{account.workspaceId ? ` · workspace ${account.workspaceId}` : " · default workspace"}</p></div><ShareButton entityType="openrouter-account" entityId={account.id} /></div><div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Total OpenRouter usage</p><div className="mt-1 flex items-end justify-between gap-3"><strong className="font-display text-5xl text-lime">{money(credits?.total_usage)}</strong><span className="text-right text-xs text-text-tertiary">{money(credits?.remaining)} remaining<br />of {money(credits?.total_credits)} purchased</span></div><div className="mt-4"><Progress used={Number(credits?.total_usage || 0)} limit={Number(credits?.total_credits || 0) || null} /></div></div><div className="grid grid-cols-2 gap-2"><Metric label="30d requests" value={compact(totalRequests)} accent /><Metric label="30d tokens" value={compact(totalTokens)} /><Metric label="Provider keys" value={account.snapshot?.keys?.length || 0} /><Metric label="Tracked in Sentinel" value={account.keys.length} /></div></div>{account.lastError && <p className="mt-4 rounded-lg bg-coral/[.06] p-3 text-xs text-coral">Latest sync: {account.lastError}. Showing the last good snapshot.</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Tracked API keys</h3><p className="text-xs text-text-tertiary">Provision a controlled key in OpenRouter or securely import an existing one, then assign developers now or later.</p></div><button onClick={() => setKeyAccountId(keyAccountId === account.id ? null : account.id)} className="rounded-full bg-violet/10 px-4 py-2 text-xs font-bold text-violet">{keyAccountId === account.id ? "Close" : "Create / import API key"}</button></div>
      {keyAccountId === account.id && <form onSubmit={addKey} className="card border-violet/15 p-5"><div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-bg-deep p-1">{(["CREATE", "IMPORT"] as const).map((source) => <button key={source} type="button" onClick={() => setKeyForm({ ...keyForm, source })} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${keyForm.source === source ? "bg-lime text-bg-void" : "text-text-tertiary"}`}>{source === "CREATE" ? "Create in OpenRouter" : "Import existing"}</button>)}</div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-text-tertiary">Key name<input required value={keyForm.name} onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })} className="input mt-1.5" /></label>{keyForm.source === "IMPORT" && <label className="text-xs text-text-tertiary">OpenRouter API key<input required type="password" autoComplete="off" value={keyForm.key} onChange={(event) => setKeyForm({ ...keyForm, key: event.target.value })} className="input mt-1.5" /></label>}<label className="text-xs text-text-tertiary">Spending limit in USD<input type="number" min="0" step="0.01" value={keyForm.configuredLimit} onChange={(event) => setKeyForm({ ...keyForm, configuredLimit: event.target.value })} className="input mt-1.5" /></label>{keyForm.source === "CREATE" && <><label className="text-xs text-text-tertiary">Limit reset<select value={keyForm.limitReset} onChange={(event) => setKeyForm({ ...keyForm, limitReset: event.target.value })} className="input mt-1.5"><option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="text-xs text-text-tertiary">Workspace ID (optional)<input value={keyForm.workspaceId} onChange={(event) => setKeyForm({ ...keyForm, workspaceId: event.target.value })} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">Expires at (optional)<input type="datetime-local" value={keyForm.expiresAt} onChange={(event) => setKeyForm({ ...keyForm, expiresAt: event.target.value })} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">OpenRouter creator user ID (optional)<input value={keyForm.creatorUserId} onChange={(event) => setKeyForm({ ...keyForm, creatorUserId: event.target.value })} className="input mt-1.5" /></label><label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3 text-xs text-text-secondary"><input type="checkbox" checked={keyForm.includeByokInLimit} onChange={(event) => setKeyForm({ ...keyForm, includeByokInLimit: event.target.checked })} className="h-4 w-4 accent-[var(--lime)]" />Count BYOK usage toward limit</label></>}</div><p className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Assign developers (optional)</p><AssigneePicker developers={developers} selected={keyForm.assigneeIds} onChange={(assigneeIds) => setKeyForm({ ...keyForm, assigneeIds })} /><div className="mt-4 flex items-center justify-between gap-3"><p className="max-w-xl text-[10px] leading-4 text-text-tertiary">{keyForm.source === "CREATE" ? "OpenRouter returns the plaintext once. Sentinel encrypts it immediately and rolls the remote key back if secure local storage fails." : "The imported plaintext is sent only to Sentinel's server for validation and encryption."}</p><button disabled={saving} className="shrink-0 rounded-full bg-lime px-5 py-2 text-sm font-bold text-bg-void">{saving ? "Provisioning securely…" : keyForm.source === "CREATE" ? "Create & assign key" : "Import protected key"}</button></div></form>}
      {account.keys.length ? <div className="space-y-5">{account.keys.map((key) => <KeyCard key={key.id} keyItem={key} role={role} developers={developers} reload={load} />)}</div> : <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-text-tertiary">No plaintext keys have been added to Sentinel yet. Provider inventory remains visible below.</div>}
      <details className="card group overflow-hidden"><summary className="cursor-pointer list-none p-5"><b>OpenRouter provider inventory</b><span className="float-right text-text-tertiary group-open:rotate-180">⌄</span><p className="mt-1 text-xs font-normal text-text-tertiary">Every field returned for every account key, including keys not stored in Sentinel.</p></summary><div className="space-y-4 border-t border-[var(--border)] p-5">{(account.snapshot?.keys || []).map((providerKey, index) => <div key={String(providerKey.hash || index)} className="rounded-xl border border-[var(--border)] p-4"><h4 className="mb-3 text-sm font-bold">{String(providerKey.name || providerKey.label || `Provider key ${index + 1}`)}</h4><DetailGrid value={providerKey} /></div>)}</div></details>
      <details className="card group overflow-hidden"><summary className="cursor-pointer list-none p-5"><b>Account model & provider activity</b><span className="float-right text-text-tertiary group-open:rotate-180">⌄</span><p className="mt-1 text-xs font-normal text-text-tertiary">Last 30 completed UTC days, grouped by endpoint.</p></summary><div className="border-t border-[var(--border)] p-5"><ActivityTable activity={activity} /></div></details>
    </section>; })}</div> : <div className="card p-10 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-lime/20 bg-lime/[.06] font-display text-xl text-lime">OR</div><h2 className="mt-4 text-lg font-bold">Connect your first OpenRouter account</h2><p className="mx-auto mt-2 max-w-lg text-sm text-text-tertiary">Sentinel will show purchased credits, total usage, remaining balance, provider inventory, and per-key accounting without exposing management credentials to the browser.</p><button onClick={() => setShowAccountForm(true)} className="mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-bg-void">Connect account</button></div>)}
  </div>;
}
