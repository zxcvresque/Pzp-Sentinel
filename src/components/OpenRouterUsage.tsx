"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ShareButton from "@/components/ShareButton";
import ServicesNav from "@/components/ServicesNav";
import TgUser from "@/components/TgUser";
import OpenRouterLogo from "@/components/OpenRouterLogo";

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
  workspaces?: Workspace[];
};
type Workspace = { id: string; name: string; slug: string; description?: string | null };
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

function DetailGrid({ entries }: { entries: Array<[string, unknown]> }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{entries.map(([key, raw]) => <Metric key={key} label={key.replaceAll("_", " ")} value={raw == null ? "—" : typeof raw === "object" ? JSON.stringify(raw) : typeof raw === "boolean" ? raw ? "Yes" : "No" : String(raw)} />)}</div>;
}

const ESSENTIAL_USAGE_FIELDS = new Set(["label", "workspace_id", "limit", "limit_remaining", "limit_reset", "usage", "usage_daily", "usage_weekly", "usage_monthly", "expires_at", "disabled"]);

function UsageDetails({ value }: { value: Usage }) {
  const entries = Object.entries(value);
  const essential = entries.filter(([key]) => ESSENTIAL_USAGE_FIELDS.has(key));
  const advanced = entries.filter(([key]) => !ESSENTIAL_USAGE_FIELDS.has(key));
  return <div className="space-y-3"><div><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-bold">Essential key information</h4><span className="font-mono text-[8px] uppercase text-text-tertiary">OpenRouter live data</span></div><DetailGrid entries={essential} /></div>{advanced.length > 0 && <details className="group rounded-xl border border-[var(--border)] bg-white/[.012]"><summary className="cursor-pointer list-none p-3 text-xs font-bold">Advanced · all provider fields <span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-[var(--border)] p-3"><DetailGrid entries={advanced} /></div></details>}</div>;
}

function ActivityTable({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-text-tertiary">No activity was returned for the last 30 completed UTC days.</div>;
  return <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-white/[.025] font-mono text-[8px] uppercase tracking-[.12em] text-text-tertiary"><tr><th className="p-3">Date / endpoint</th><th className="p-3">Model</th><th className="p-3">Provider</th><th className="p-3 text-right">Requests</th><th className="p-3 text-right">Prompt</th><th className="p-3 text-right">Completion</th><th className="p-3 text-right">Reasoning</th><th className="p-3 text-right">Usage</th><th className="p-3 text-right">BYOK</th></tr></thead><tbody>{activity.map((row, index) => <tr key={`${row.date}-${row.endpoint_id}-${index}`} className="border-t border-[var(--border)]"><td className="p-3"><b>{row.date}</b><small className="mt-1 block font-mono text-[8px] text-text-tertiary">{row.endpoint_id}</small></td><td className="p-3"><b>{row.model}</b><small className="mt-1 block text-text-tertiary">{row.model_permaslug}</small></td><td className="p-3">{row.provider_name}{row.workspace_id && <small className="mt-1 block text-text-tertiary">{row.workspace_id}</small>}</td><td className="p-3 text-right">{compact(row.requests)}</td><td className="p-3 text-right">{compact(row.prompt_tokens)}</td><td className="p-3 text-right">{compact(row.completion_tokens)}</td><td className="p-3 text-right">{compact(row.reasoning_tokens)}</td><td className="p-3 text-right font-bold text-lime">{money(row.usage)}</td><td className="p-3 text-right">{money(row.byok_usage_inference)}</td></tr>)}</tbody></table></div>;
}

function AssigneePicker({ developers, selected, onChange }: { developers: Developer[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <div className="grid gap-2 sm:grid-cols-2">{developers.map((dev) => { const active = selected.includes(dev.id); return <button key={dev.id} type="button" onClick={() => onChange(active ? selected.filter((id) => id !== dev.id) : [...selected, dev.id])} className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition ${active ? "border-lime/30 bg-lime/[.06]" : "border-[var(--border)] bg-bg-deep"}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] ${active ? "border-lime bg-lime text-bg-void" : "border-[var(--border)]"}`}>{active ? "✓" : ""}</span><TgUser name={dev.name} photoUrl={dev.photoUrl} size={34} avatarOnly /><span className="min-w-0"><b className="block truncate text-xs">{dev.name}</b><small className="block truncate text-[10px] text-text-tertiary">{dev.telegramUser ? `@${dev.telegramUser}` : "No Telegram username"}</small></span></button>; })}</div>;
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
  const [editLimitReset, setEditLimitReset] = useState(typeof usage.limit_reset === "string" ? usage.limit_reset : "");
  const [editIncludeByok, setEditIncludeByok] = useState(usage.include_byok_in_limit === true);
  const [editEnabled, setEditEnabled] = useState(keyItem.enabled && usage.disabled !== true);
  const [editAssignees, setEditAssignees] = useState(keyItem.assignees.map((dev) => dev.id));
  const [revokeConfirmation, setRevokeConfirmation] = useState("");
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

  function toggleManagement() {
    if (!editing) {
      setEditName(keyItem.name);
      setEditLimit(keyItem.configuredLimit ?? (typeof usage.limit === "number" ? String(usage.limit) : ""));
      setEditLimitReset(typeof usage.limit_reset === "string" ? usage.limit_reset : "");
      setEditIncludeByok(usage.include_byok_in_limit === true);
      setEditEnabled(keyItem.enabled && usage.disabled !== true);
      setEditAssignees(keyItem.assignees.map((dev) => dev.id));
      setRevokeConfirmation("");
      setError("");
    }
    setEditing(!editing);
  }

  async function saveAccess() {
    setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/keys/${keyItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName, configuredLimit: editLimit, limitReset: editLimitReset, includeByokInLimit: editIncludeByok, enabled: editEnabled, assigneeIds: editAssignees }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || "Unable to update key"); return; }
    setEditing(false); await reload(false);
  }

  async function revokeKey() {
    setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/keys/${keyItem.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: revokeConfirmation }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || "Unable to revoke key"); return; }
    setEditing(false); await reload(false);
  }

  return <article id={`openrouter-key-${keyItem.id}`} data-share-target={`openrouter-key:${keyItem.id}`} className="card scroll-mt-24 overflow-hidden border-lime/10">
    <div className="border-b border-[var(--border)] bg-gradient-to-br from-lime/[.06] via-transparent to-violet/[.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><OpenRouterLogo width={30} className="mt-0.5 h-6 w-auto" /><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-extrabold">{keyItem.name}</h3><span className={`rounded-full px-2 py-1 font-mono text-[8px] uppercase ${keyItem.enabled && usage.disabled !== true ? "bg-mint/10 text-mint" : "bg-coral/10 text-coral"}`}>{keyItem.enabled && usage.disabled !== true ? "Live" : "Disabled"}</span>{usage.limit_reset && <span className="rounded-full bg-violet/10 px-2 py-1 font-mono text-[8px] uppercase text-violet">{String(usage.limit_reset)} reset</span>}</div><p className="mt-1 font-mono text-[10px] text-text-tertiary">{keyItem.maskedKey} · synced {stamp(keyItem.lastFetchedAt)}</p></div></div><div className="flex flex-wrap gap-2">{role === "ADMIN" && <ShareButton entityType="openrouter-key" entityId={keyItem.id} />}<button onClick={() => reveal(false)} disabled={busy} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-lime">{busy ? "Checking…" : revealed ? "Hide key" : "Reveal key"}</button><button onClick={() => reveal(true)} disabled={busy} className="rounded-full bg-lime px-3 py-1.5 text-xs font-semibold text-bg-void">Copy key</button>{role === "ADMIN" && <button onClick={toggleManagement} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary">{editing ? "Close manage" : "Manage key"}</button>}</div></div>
      {revealed && <div className="mt-4 break-all rounded-xl border border-amber/20 bg-amber/[.04] p-3 font-mono text-xs text-amber">{revealed}</div>}
      {error && !editing && <p className="mt-3 text-xs text-coral">{error}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Lifetime spend</p><div className="mt-1 flex items-end justify-between gap-3"><strong className="font-display text-4xl text-lime">{money(used)}</strong><span className="text-xs text-text-tertiary">{displayedLimit == null ? "No configured ceiling" : `${money(Math.max(0, displayedLimit - used))} remaining`}</span></div><div className="mt-3"><Progress used={used} limit={displayedLimit} /></div></div><div className="grid grid-cols-2 gap-2"><Metric label="Today" value={money(usage.usage_daily)} accent /><Metric label="This week" value={money(usage.usage_weekly)} /><Metric label="This month" value={money(usage.usage_monthly)} /><Metric label="Limit" value={displayedLimit == null ? "Unlimited" : money(displayedLimit)} /></div></div>
    </div>
    {editing && <div className="border-b border-[var(--border)] bg-violet/[.025] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-violet">OpenRouter key controls</p><h4 className="mt-1 text-base font-bold">Manage {keyItem.name}</h4><p className="mt-1 text-[10px] text-text-tertiary">Provider controls are applied to OpenRouter first, then saved in Sentinel.</p></div><span className="rounded-full border border-[var(--border)] px-2.5 py-1 font-mono text-[8px] text-text-tertiary">{keyItem.maskedKey}</span></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs text-text-tertiary">Key name<input value={editName} onChange={(event) => setEditName(event.target.value)} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">Provider spending limit (USD)<input type="number" min="0" step="0.01" value={editLimit} onChange={(event) => setEditLimit(event.target.value)} className="input mt-1.5" placeholder="Unlimited" /></label><label className="text-xs text-text-tertiary">Limit reset<select value={editLimitReset} onChange={(event) => setEditLimitReset(event.target.value)} className="input mt-1.5"><option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${editEnabled ? "border-mint/20 bg-mint/[.035]" : "border-amber/20 bg-amber/[.035]"}`}><span><b className="block text-xs">API key enabled</b><small className="mt-1 block text-[10px] text-text-tertiary">Disabling stops usage at OpenRouter without deleting the key.</small></span><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} className="h-5 w-5 accent-[var(--lime)]" /></label><label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3"><span><b className="block text-xs">Count BYOK toward limit</b><small className="mt-1 block text-[10px] text-text-tertiary">Include BYOK usage in this spending ceiling.</small></span><input type="checkbox" checked={editIncludeByok} onChange={(event) => setEditIncludeByok(event.target.checked)} className="h-5 w-5 accent-[var(--lime)]" /></label></div>
      <p className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Only selected developers can see usage or reveal this key</p><AssigneePicker developers={developers} selected={editAssignees} onChange={setEditAssignees} />
      {error && <p className="mt-3 rounded-xl border border-coral/20 bg-coral/[.05] p-3 text-xs text-coral">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(false)} disabled={busy} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs">Cancel</button><button disabled={busy || !editName.trim()} onClick={saveAccess} className="rounded-full bg-lime px-4 py-2 text-xs font-bold text-bg-void disabled:opacity-40">{busy ? "Saving at OpenRouter…" : "Save key controls"}</button></div>
      <details className="group mt-5 rounded-xl border border-coral/15 bg-coral/[.025]"><summary className="cursor-pointer list-none p-4 text-xs font-bold text-coral">Danger zone · permanently revoke key <span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span></summary><div className="space-y-3 border-t border-coral/10 p-4"><p className="text-xs leading-5 text-text-tertiary">This permanently revokes the API key at OpenRouter and removes its encrypted secret, usage cache and developer assignments from Sentinel. This cannot be undone.</p><label className="block text-xs text-text-tertiary">Type <b className="text-text-primary">{keyItem.name}</b> to confirm<input value={revokeConfirmation} onChange={(event) => setRevokeConfirmation(event.target.value)} className="input mt-1.5" /></label><div className="flex justify-end"><button type="button" onClick={revokeKey} disabled={busy || revokeConfirmation !== keyItem.name} className="rounded-full bg-coral px-4 py-2 text-xs font-bold text-bg-void disabled:cursor-not-allowed disabled:opacity-35">{busy ? "Revoking at OpenRouter…" : "Revoke key permanently"}</button></div></div></details>
    </div>}
    <div className="space-y-5 p-5 sm:p-6"><UsageDetails value={usage} /><details className="group"><summary className="cursor-pointer list-none rounded-xl border border-[var(--border)] bg-white/[.015] p-3 text-xs font-bold">Advanced · 30-day model & provider activity <span className="float-right text-text-tertiary group-open:rotate-180">⌄</span></summary><div className="pt-3"><ActivityTable activity={keyItem.activity || []} /></div></details>{keyItem.assignees.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[8px] uppercase text-text-tertiary">Assigned</span>{keyItem.assignees.map((dev) => <span key={dev.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] py-1 pl-1 pr-2.5 text-[10px]"><TgUser name={dev.name} photoUrl={dev.photoUrl} size={20} avatarOnly />{dev.name}</span>)}</div>}</div>
  </article>;
}

function AccountManager({ account, reload }: { account: Account; reload: (refresh?: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [workspaceId, setWorkspaceId] = useState(account.workspaceId || "");
  const [enabled, setEnabled] = useState(account.enabled);
  const [managementKey, setManagementKey] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>(account.snapshot?.workspaces || []);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function show() {
    setName(account.name); setWorkspaceId(account.workspaceId || ""); setEnabled(account.enabled);
    setManagementKey(""); setWorkspaces(account.snapshot?.workspaces || []); setConfirmation(""); setError(""); setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, workspaceId, enabled, managementKey }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) {
      if (Array.isArray(data.workspaces)) {
        const discovered = data.workspaces as Workspace[];
        setWorkspaces(discovered);
        if (!discovered.some((workspace) => workspace.id === workspaceId)) setWorkspaceId(discovered.length === 1 ? discovered[0].id : "");
      }
      setError(data.error || "Unable to update account"); return;
    }
    setOpen(false); await reload(false);
  }

  async function remove() {
    setBusy(true); setError("");
    const response = await fetch(`/api/openrouter/accounts/${account.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || "Unable to remove account"); return; }
    setOpen(false); await reload(false);
  }

  return <><button type="button" onClick={show} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-lime/30 hover:bg-lime/[.04] hover:text-lime">Manage</button>{open && <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby={`manage-openrouter-${account.id}`} className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl border border-lime/20 bg-bg-card shadow-[0_30px_120px_rgba(0,0,0,.65)]"><div className="flex items-start justify-between gap-4 border-b border-[var(--border)] bg-gradient-to-br from-lime/[.07] via-transparent to-violet/[.035] p-5"><div><p className="font-mono text-[8px] uppercase tracking-[.16em] text-lime">OpenRouter account controls</p><h2 id={`manage-openrouter-${account.id}`} className="mt-1 text-xl font-extrabold">Manage {account.name}</h2><p className="mt-1 text-xs text-text-tertiary">Update Sentinel’s encrypted connection without exposing the stored management key.</p></div><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-text-tertiary">Close</button></div><form onSubmit={save} className="space-y-4 p-5"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-text-tertiary">Account name<input required value={name} onChange={(event) => setName(event.target.value)} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="input mt-1.5" required={workspaces.length > 1}><option value="">OpenRouter default</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.slug}</option>)}</select></label></div><label className="block text-xs text-text-tertiary">Replace management key <span className="text-text-tertiary/70">(leave blank to keep the encrypted key)</span><input type="password" autoComplete="off" value={managementKey} onChange={(event) => setManagementKey(event.target.value)} className="input mt-1.5 font-mono" placeholder="Paste a new management key only when rotating" /></label><label className={`flex items-center justify-between gap-4 rounded-xl border p-3 transition ${enabled ? "border-mint/20 bg-mint/[.035]" : "border-amber/20 bg-amber/[.035]"}`}><span><b className="block text-xs">Automatic usage sync</b><small className="mt-1 block text-[10px] text-text-tertiary">{enabled ? "Account and per-key usage refresh normally." : "Sync is paused; stored usage and assigned access remain visible."}</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-5 w-5 accent-[var(--lime)]" /></label>{error && <p className="rounded-xl border border-coral/20 bg-coral/[.05] p-3 text-xs text-coral">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-text-secondary">Cancel</button><button disabled={busy || !name.trim() || (workspaces.length > 1 && !workspaceId)} className="rounded-full bg-lime px-5 py-2 text-xs font-bold text-bg-void disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Saving securely…" : managementKey ? "Validate key & save" : "Save account"}</button></div></form><details className="group border-t border-coral/15 bg-coral/[.02]"><summary className="cursor-pointer list-none p-5 text-xs font-bold text-coral">Danger zone · remove from Sentinel <span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span></summary><div className="space-y-3 border-t border-coral/10 p-5"><p className="text-xs leading-5 text-text-tertiary">This permanently removes the encrypted management key, {account.keys.length} locally stored API key{account.keys.length === 1 ? "" : "s"}, assignments and cached usage from Sentinel. It does <b className="text-text-secondary">not</b> revoke keys at OpenRouter.</p><label className="block text-xs text-text-tertiary">Type <b className="text-text-primary">{account.name}</b> to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="input mt-1.5" /></label><div className="flex justify-end"><button type="button" onClick={remove} disabled={busy || confirmation !== account.name} className="rounded-full bg-coral px-5 py-2 text-xs font-bold text-bg-void disabled:cursor-not-allowed disabled:opacity-35">{busy ? "Removing…" : "Remove account from Sentinel"}</button></div></div></details></section></div>}</>;
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
  const [accountWorkspaces, setAccountWorkspaces] = useState<Workspace[]>([]);
  const [discoveringWorkspaces, setDiscoveringWorkspaces] = useState(false);
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

  async function discoverWorkspaces() {
    const managementKey = accountForm.managementKey.trim();
    if (!managementKey || discoveringWorkspaces) return null;
    setDiscoveringWorkspaces(true); setError("");
    const response = await fetch("/api/openrouter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "WORKSPACES", managementKey }) });
    const data = await response.json();
    setDiscoveringWorkspaces(false);
    if (!response.ok) { setAccountWorkspaces([]); setError(data.error || "Unable to discover OpenRouter workspaces"); return null; }
    const workspaces = (data.workspaces || []) as Workspace[];
    setAccountWorkspaces(workspaces);
    setAccountForm((current) => ({ ...current, workspaceId: workspaces.length === 1 ? workspaces[0].id : workspaces.some((workspace) => workspace.id === current.workspaceId) ? current.workspaceId : "" }));
    return workspaces;
  }

  async function addAccount(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/openrouter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ACCOUNT", ...accountForm }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) {
      if (Array.isArray(data.workspaces)) {
        const workspaces = data.workspaces as Workspace[];
        setAccountWorkspaces(workspaces);
        setAccountForm((current) => ({ ...current, workspaceId: workspaces.length === 1 ? workspaces[0].id : current.workspaceId }));
      }
      setError(data.error || "Unable to add account"); return;
    }
    setShowAccountForm(false); setAccountWorkspaces([]); setAccountForm({ name: "Primary OpenRouter", managementKey: "", workspaceId: "" }); await load(false);
  }

  async function addKey(event: React.FormEvent) {
    event.preventDefault(); if (!keyAccountId) return; setSaving(true); setError("");
    const response = await fetch("/api/openrouter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "KEY", accountId: keyAccountId, ...keyForm }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to add key"); return; }
    setKeyAccountId(null); setKeyForm({ source: "CREATE", name: "", key: "", configuredLimit: "", limitReset: "monthly", includeByokInLimit: true, workspaceId: "", expiresAt: "", creatorUserId: "", assigneeIds: [] }); await load(false);
  }

  function toggleKeyForm(account: Account) {
    if (keyAccountId === account.id) { setKeyAccountId(null); return; }
    setKeyAccountId(account.id);
    setKeyForm({ source: "CREATE", name: "", key: "", configuredLimit: "", limitReset: "monthly", includeByokInLimit: true, workspaceId: account.workspaceId || account.snapshot?.workspaces?.[0]?.id || "", expiresAt: "", creatorUserId: "", assigneeIds: [] });
  }

  if (loading) return <div><ServicesNav role={role} /><div className="grid gap-4"><div className="skeleton h-44" /><div className="skeleton h-80" /></div></div>;
  const keys = role === "DEV" ? devKeys : [];

  return <div className="mx-auto max-w-[1500px]"><ServicesNav role={role} />
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4"><OpenRouterLogo width={54} priority className="mt-0.5 h-11 w-auto drop-shadow-[0_0_22px_rgba(191,255,0,.13)]" /><div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-lime">OpenRouter · live accounting</p><h1 className="mt-1 text-3xl font-extrabold">Usage <span className="font-display text-lime">control room</span></h1><p className="mt-2 max-w-2xl text-sm text-text-tertiary">Account credits, per-key limits, BYOK spend, and 30-day model activity. Secrets are encrypted at rest and revealed only through an audited action.</p></div></div>{accounts.length > 0 && <div className="flex gap-2"><button onClick={() => load(true)} disabled={refreshing} className="rounded-full border border-[var(--border)] px-4 py-2.5 text-xs font-bold text-text-secondary">{refreshing ? "Syncing OpenRouter…" : "Sync now"}</button>{role === "ADMIN" && <button onClick={() => setShowAccountForm(!showAccountForm)} className="rounded-full bg-lime px-4 py-2.5 text-xs font-bold text-bg-void">Add account</button>}</div>}</div>
    {error && <div className="mb-4 rounded-xl border border-coral/20 bg-coral/[.05] p-4 text-sm text-coral">{error}</div>}
    {showAccountForm && <form onSubmit={addAccount} className="card mb-6 overflow-hidden border-lime/15 bg-gradient-to-br from-lime/[.035] via-bg-card to-violet/[.025]"><div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"><div className="flex items-start gap-3"><span className="grid h-12 w-14 shrink-0 place-items-center rounded-xl border border-lime/20 bg-black/20"><OpenRouterLogo width={42} className="h-8 w-auto" /></span><div><h2 className="text-base font-bold text-text-primary">Connect an OpenRouter account</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-text-tertiary">Paste the Management API key once. Sentinel validates it, discovers its workspaces, and encrypts it with AES-256-GCM.</p></div></div><button type="button" onClick={() => { setShowAccountForm(false); setAccountWorkspaces([]); }} className="self-start rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-text-tertiary transition hover:border-[var(--border-hover)] hover:text-text-primary">Close</button></div><div className="grid items-start gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[.8fr_1.2fr]"><label className="grid min-w-0 gap-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">Account name</span><input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} className="input" placeholder="Primary OpenRouter" /></label><label className="grid min-w-0 gap-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">Management API key</span><input required type="password" autoComplete="off" value={accountForm.managementKey} onChange={(event) => { setAccountForm({ ...accountForm, managementKey: event.target.value, workspaceId: "" }); setAccountWorkspaces([]); }} onBlur={() => void discoverWorkspaces()} className="input font-mono" placeholder="Paste management key" /><small className="min-h-4 text-[10px] leading-4 text-text-tertiary">{discoveringWorkspaces ? "Discovering available workspaces…" : accountWorkspaces.length ? `${accountWorkspaces.length} workspace${accountWorkspaces.length === 1 ? "" : "s"} discovered securely.` : "Workspace access is discovered automatically after validation."}</small></label>{accountWorkspaces.length > 0 && <label className="grid min-w-0 gap-2 rounded-xl border border-lime/15 bg-lime/[.025] p-3 lg:col-span-2"><span className="font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">OpenRouter workspace {accountWorkspaces.length === 1 && <i className="font-sans font-normal normal-case tracking-normal text-mint">automatically selected</i>}</span><select required={accountWorkspaces.length > 1} value={accountForm.workspaceId} onChange={(event) => setAccountForm({ ...accountForm, workspaceId: event.target.value })} className="input"><option value="">{accountWorkspaces.length > 1 ? "Choose a workspace" : "OpenRouter default workspace"}</option>{accountWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.slug}</option>)}</select></label>}</div><div className="flex flex-col gap-3 border-t border-[var(--border)] bg-black/[.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="flex items-center gap-2 text-[10px] text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-mint" />Encrypted before it is written to the database</p><button disabled={saving || discoveringWorkspaces || !accountForm.name.trim() || !accountForm.managementKey.trim() || (accountWorkspaces.length > 1 && !accountForm.workspaceId)} className="inline-flex min-h-10 items-center justify-center rounded-full bg-lime px-5 py-2 text-sm font-bold text-bg-void shadow-[0_8px_28px_rgba(111,209,215,.12)] transition hover:-translate-y-px hover:bg-lime/90 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Validating securely…" : discoveringWorkspaces ? "Finding workspaces…" : "Connect account"}</button></div></form>}

    {role === "DEV" && <><section className="mb-6 overflow-hidden rounded-2xl border border-lime/20 bg-gradient-to-br from-lime/[.09] via-bg-card to-violet/[.05] p-6"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-lime">Your assigned OpenRouter envelope</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><strong className="font-display text-4xl text-lime">{money(devSummary.spend)}</strong><small className="mt-1 block text-text-tertiary">Lifetime across {devKeys.length} assigned key{devKeys.length === 1 ? "" : "s"}</small></div><Metric label="This month" value={money(devSummary.month)} /><Metric label="Visibility" value="Assigned keys only" /></div></section>{keys.length ? <div className="space-y-5">{keys.map((key) => <KeyCard key={key.id} keyItem={key} role={role} developers={[]} reload={load} />)}</div> : <div className="card p-10 text-center"><h2 className="font-bold">No OpenRouter keys assigned</h2><p className="mt-2 text-sm text-text-tertiary">An admin can assign a key without exposing any other account data.</p></div>}</>}

    {role === "ADMIN" && (accounts.length ? <div className="space-y-8">{accounts.map((account) => { const credits = account.snapshot?.credits; const activity = account.snapshot?.activity || []; const workspace = account.snapshot?.workspaces?.find((item) => item.id === account.workspaceId); const totalRequests = activity.reduce((sum, row) => sum + Number(row.requests || 0), 0); const totalTokens = activity.reduce((sum, row) => sum + Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0) + Number(row.reasoning_tokens || 0), 0); return <section key={account.id} data-share-target={`openrouter-account:${account.id}`} className="space-y-5"><div className={`overflow-hidden rounded-2xl border bg-gradient-to-br from-lime/[.11] via-bg-card to-violet/[.07] p-6 shadow-[0_24px_90px_rgba(111,209,215,.06)] ${account.enabled ? "border-lime/25" : "border-amber/20"}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-[9px] uppercase tracking-[.16em] text-lime">Account-level usage · always visible</p>{!account.enabled && <span className="rounded-full bg-amber/10 px-2 py-1 font-mono text-[8px] uppercase text-amber">Sync paused</span>}</div><h2 className="mt-1 text-2xl font-extrabold">{account.name}</h2><p className="mt-1 text-xs text-text-tertiary">Management sync {stamp(account.lastFetchedAt)} · {workspace ? `${workspace.name} workspace` : account.workspaceId ? `workspace ${account.workspaceId}` : "OpenRouter default workspace"}</p></div><div className="flex flex-wrap gap-2"><ShareButton entityType="openrouter-account" entityId={account.id} contextTitle={account.name} contextDetails={`${money(credits?.total_usage)} used · ${money(credits?.remaining)} remaining`} /><AccountManager account={account} reload={load} /></div></div><div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Total OpenRouter usage</p><div className="mt-1 flex items-end justify-between gap-3"><strong className="font-display text-5xl text-lime">{money(credits?.total_usage)}</strong><span className="text-right text-xs text-text-tertiary">{money(credits?.remaining)} remaining<br />of {money(credits?.total_credits)} purchased</span></div><div className="mt-4"><Progress used={Number(credits?.total_usage || 0)} limit={Number(credits?.total_credits || 0) || null} /></div></div><div className="grid grid-cols-2 gap-2"><Metric label="30d requests" value={compact(totalRequests)} accent /><Metric label="30d tokens" value={compact(totalTokens)} /><Metric label="Provider keys" value={account.snapshot?.keys?.length || 0} /><Metric label="Tracked in Sentinel" value={account.keys.length} /></div></div>{account.lastError && <p className="mt-4 rounded-lg bg-coral/[.06] p-3 text-xs text-coral">Latest sync: {account.lastError}. Showing the last good snapshot.</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Tracked API keys</h3><p className="text-xs text-text-tertiary">Provision a controlled key in OpenRouter or securely import an existing one, then assign developers now or later.</p></div><button onClick={() => toggleKeyForm(account)} className="rounded-full bg-violet/10 px-4 py-2 text-xs font-bold text-violet">{keyAccountId === account.id ? "Close" : "Create / import API key"}</button></div>
      {keyAccountId === account.id && <form onSubmit={addKey} className="card border-violet/15 p-5"><div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-bg-deep p-1">{(["CREATE", "IMPORT"] as const).map((source) => <button key={source} type="button" onClick={() => setKeyForm({ ...keyForm, source })} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${keyForm.source === source ? "bg-lime text-bg-void" : "text-text-tertiary"}`}>{source === "CREATE" ? "Create in OpenRouter" : "Import existing"}</button>)}</div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-text-tertiary">Key name<input required value={keyForm.name} onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })} className="input mt-1.5" /></label>{keyForm.source === "IMPORT" && <label className="text-xs text-text-tertiary">OpenRouter API key<input required type="password" autoComplete="off" value={keyForm.key} onChange={(event) => setKeyForm({ ...keyForm, key: event.target.value })} className="input mt-1.5" /></label>}<label className="text-xs text-text-tertiary">Spending limit in USD<input type="number" min="0" step="0.01" value={keyForm.configuredLimit} onChange={(event) => setKeyForm({ ...keyForm, configuredLimit: event.target.value })} className="input mt-1.5" /></label>{keyForm.source === "CREATE" && <label className="text-xs text-text-tertiary">Limit reset<select value={keyForm.limitReset} onChange={(event) => setKeyForm({ ...keyForm, limitReset: event.target.value })} className="input mt-1.5"><option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>}</div>{keyForm.source === "CREATE" && <details className="group mt-4 rounded-xl border border-[var(--border)] bg-white/[.012]"><summary className="cursor-pointer list-none p-3 text-xs font-bold">Advanced key settings <span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span><small className="ml-2 font-normal text-text-tertiary">Workspace, expiry, creator and BYOK accounting</small></summary><div className="grid gap-3 border-t border-[var(--border)] p-3 md:grid-cols-3"><label className="text-xs text-text-tertiary">Workspace<select value={keyForm.workspaceId} onChange={(event) => setKeyForm({ ...keyForm, workspaceId: event.target.value })} className="input mt-1.5"><option value="">OpenRouter default</option>{(account.snapshot?.workspaces || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.slug}</option>)}</select></label><label className="text-xs text-text-tertiary">Expires at<input type="datetime-local" value={keyForm.expiresAt} onChange={(event) => setKeyForm({ ...keyForm, expiresAt: event.target.value })} className="input mt-1.5" /></label><label className="text-xs text-text-tertiary">OpenRouter creator user ID<input value={keyForm.creatorUserId} onChange={(event) => setKeyForm({ ...keyForm, creatorUserId: event.target.value })} className="input mt-1.5" /></label><label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3 text-xs text-text-secondary"><input type="checkbox" checked={keyForm.includeByokInLimit} onChange={(event) => setKeyForm({ ...keyForm, includeByokInLimit: event.target.checked })} className="h-4 w-4 accent-[var(--lime)]" />Count BYOK usage toward limit</label></div></details>}<p className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Assign developers (optional)</p><AssigneePicker developers={developers} selected={keyForm.assigneeIds} onChange={(assigneeIds) => setKeyForm({ ...keyForm, assigneeIds })} /><div className="mt-4 flex items-center justify-between gap-3"><p className="max-w-xl text-[10px] leading-4 text-text-tertiary">{keyForm.source === "CREATE" ? "OpenRouter returns the plaintext once. Sentinel encrypts it immediately and rolls the remote key back if secure local storage fails." : "The imported plaintext is sent only to Sentinel's server for validation and encryption."}</p><button disabled={saving} className="shrink-0 rounded-full bg-lime px-5 py-2 text-sm font-bold text-bg-void">{saving ? "Provisioning securely…" : keyForm.source === "CREATE" ? "Create & assign key" : "Import protected key"}</button></div></form>}
      {account.keys.length ? <div className="space-y-5">{account.keys.map((key) => <KeyCard key={key.id} keyItem={key} role={role} developers={developers} reload={load} />)}</div> : <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-text-tertiary">No plaintext keys have been added to Sentinel yet. Provider inventory remains visible below.</div>}
      <details className="card group overflow-hidden"><summary className="cursor-pointer list-none p-5"><b>Advanced · OpenRouter provider inventory</b><span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span><p className="mt-1 text-xs font-normal text-text-tertiary">Provider metadata for every account key, including keys not stored in Sentinel.</p></summary><div className="space-y-4 border-t border-[var(--border)] p-5">{(account.snapshot?.keys || []).map((providerKey, index) => <div key={String(providerKey.hash || index)} className="rounded-xl border border-[var(--border)] p-4"><h4 className="mb-3 text-sm font-bold">{String(providerKey.name || providerKey.label || `Provider key ${index + 1}`)}</h4><UsageDetails value={providerKey} /></div>)}</div></details>
      <details className="card group overflow-hidden"><summary className="cursor-pointer list-none p-5"><b>Advanced · account model and provider activity</b><span className="float-right text-text-tertiary transition-transform group-open:rotate-180">⌄</span><p className="mt-1 text-xs font-normal text-text-tertiary">Last 30 completed UTC days, grouped by endpoint.</p></summary><div className="border-t border-[var(--border)] p-5"><ActivityTable activity={activity} /></div></details>
    </section>; })}</div> : !showAccountForm ? <div className="card p-10 text-center"><div className="mx-auto grid h-20 w-24 place-items-center rounded-2xl border border-lime/20 bg-black/20 shadow-[0_0_40px_rgba(191,255,0,.05)]"><OpenRouterLogo width={70} className="h-14 w-auto" /></div><h2 className="mt-4 text-lg font-bold">Connect your first OpenRouter account</h2><p className="mx-auto mt-2 max-w-lg text-sm text-text-tertiary">Sentinel will discover your workspace, then show purchased credits, usage, limits and per-key accounting without exposing the management credential.</p><button onClick={() => setShowAccountForm(true)} className="mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-bg-void">Connect account</button></div> : null)}
  </div>;
}
