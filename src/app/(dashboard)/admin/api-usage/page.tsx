"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import ServicesNav from "@/components/ServicesNav";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type WindowKey = "rolling" | "weekly" | "monthly";

interface UsageWindow {
  key: WindowKey;
  label: string;
  usedPercent: number;
  resetsAt: string;
}

interface UsageAccount {
  id: string;
  provider: "OPENCODE_GO";
  name: string;
  workspaceId: string;
  expiresAt: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  hasAuthCookie: boolean;
  status: "live" | "stale" | "error" | "disabled" | "pending";
  snapshot: {
    windows: UsageWindow[];
    renewsAt: string | null;
    checkedAt: string;
    source: "dashboard" | "rpc";
  } | null;
  error: string | null;
  lastFetchedAt: string | null;
}

interface AccountFormState {
  name: string;
  workspaceId: string;
  authCookie: string;
  apiKey: string;
  expiresAt: string;
}

const EMPTY_FORM: AccountFormState = {
  name: "",
  workspaceId: "",
  authCookie: "",
  apiKey: "",
  expiresAt: "",
};

function formatDuration(target: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((new Date(target).getTime() - nowMs) / 1000));
  if (seconds <= 0) return "resetting";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCheckedAt(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function usageColor(percent: number): string {
  if (percent >= 90) return "linear-gradient(90deg, #e66d72, #bd4b55)";
  if (percent >= 70) return "linear-gradient(90deg, #f3c96b, #d79b3e)";
  return "linear-gradient(90deg, #d8d4ff, #9690d8)";
}

function statusLabel(status: UsageAccount["status"]): string {
  if (status === "live") return "Live";
  if (status === "stale") return "Last good data";
  if (status === "error") return "Needs attention";
  if (status === "disabled") return "Paused";
  return "Checking";
}

function UsageMeter({ window, nowMs }: { window: UsageWindow; nowMs: number }) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const left = Math.max(0, 100 - used);
  const color = usageColor(used);

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-xl font-bold text-[var(--text-primary)]">{window.label}</span>
        <span className="font-mono text-sm font-semibold text-[var(--text-secondary)]">
          {Math.round(used)}% used
        </span>
      </div>
      <div
        className="api-usage-meter-track h-3 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.08)" }}
        role="progressbar"
        aria-label={`${window.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
      >
        <div
          className="api-usage-meter-fill h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${used}%`, background: color }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-sm text-[var(--text-tertiary)]">
        <span>{Math.round(left)}% left</span>
        <span>resets in {formatDuration(window.resetsAt, nowMs)}</span>
      </div>
    </div>
  );
}

function AccountCard({
  account,
  nowMs,
  onEdit,
  onDelete,
  onToggle,
}: {
  account: UsageAccount;
  nowMs: number;
  onEdit: (account: UsageAccount) => void;
  onDelete: (account: UsageAccount) => void;
  onToggle: (account: UsageAccount) => void;
}) {
  const expiry = account.expiresAt ?? account.snapshot?.renewsAt ?? null;
  const isWarning = account.status === "stale" || account.status === "error";

  return (
    <article className="api-usage-card overflow-hidden p-6 sm:p-7">
      <div className="mb-7 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background:
                  account.status === "live"
                    ? "var(--mint)"
                    : isWarning
                      ? "var(--amber)"
                      : "var(--text-tertiary)",
              }}
            />
            <h2 className="truncate text-xl font-bold">{account.name}</h2>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            OpenCode Go · {statusLabel(account.status)}
          </p>
        </div>
        {expiry && (
          <span className="shrink-0 text-right text-xs text-[var(--text-secondary)]">
            Expires {new Date(expiry).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
      </div>

      {account.snapshot?.windows.length ? (
        <div className="space-y-7">
          {account.snapshot.windows.map((window) => (
            <UsageMeter key={window.key} window={window} nowMs={nowMs} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] px-4 py-6 text-center">
          <p className="text-sm font-semibold text-[var(--text-secondary)]">
            {account.status === "disabled" ? "Usage checks are paused" : "No trusted usage sample yet"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {account.error || "OpenCode is being checked now."}
          </p>
        </div>
      )}

      {isWarning && account.error && account.snapshot && (
        <div className="mt-5 rounded-lg border border-amber/20 bg-amber/5 px-3 py-2 text-xs text-amber">
          Showing the last successful sample. {account.error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
          Checked {formatCheckedAt(account.lastFetchedAt)}
          {account.snapshot?.source === "rpc" ? " · RPC fallback" : ""}
        </span>
        <div className="flex items-center gap-3 text-xs">
          <button onClick={() => onToggle(account)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            {account.enabled ? "Pause" : "Resume"}
          </button>
          <button onClick={() => onEdit(account)} className="text-lime hover:text-lime/80">Edit</button>
          <button onClick={() => onDelete(account)} className="text-coral hover:text-coral/80">Remove</button>
        </div>
      </div>
    </article>
  );
}

export default function ApiUsagePage() {
  const [accounts, setAccounts] = useState<UsageAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UsageAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (force = false, manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/api-usage${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load API usage.");
      setAccounts(data.accounts || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load API usage.");
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);
  useAutoRefresh(() => load(), 30_000);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const lastChecked = useMemo(() => {
    const timestamps = accounts.flatMap((account) => account.lastFetchedAt ? [new Date(account.lastFetchedAt).getTime()] : []);
    return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  }, [accounts]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(account: UsageAccount) {
    setEditingId(account.id);
    setForm({
      name: account.name,
      workspaceId: account.workspaceId,
      authCookie: "",
      apiKey: "",
      expiresAt: account.expiresAt?.slice(0, 10) ?? "",
    });
    setFormError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(editingId ? `/api/api-usage/${editingId}` : "/api/api-usage", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save this account.");
      closeForm();
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this account.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account: UsageAccount) {
    await fetch(`/api/api-usage/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !account.enabled, refresh: !account.enabled }),
    });
    await load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/api-usage/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="pb-20 md:pb-0">
      <ServicesNav role="ADMIN" />
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Remove ${deleteTarget?.name || "this account"}?`}
        message="Its encrypted cookie, API key, and cached usage samples will be deleted."
        confirmLabel="Remove"
        variant="danger"
        loading={deleting}
      />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Live usage</h1>
            {accounts.some((account) => account.status === "live") && (
              <span className="api-usage-live-copy text-sm text-[var(--text-tertiary)]">
                <span className="api-usage-live-dot" /> Usage is current.
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            Workspace-scoped OpenCode Go limits · refreshes every 30 seconds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true, true)}
            disabled={refreshing}
            className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
          <button onClick={openCreate} className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-bg-void hover:bg-lime/90">
            Add account
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={submitForm} className="card mb-7 p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">{editingId ? "Edit OpenCode account" : "Connect OpenCode Go"}</h2>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Secrets are encrypted at rest and are never returned to the browser after saving.
              </p>
            </div>
            <button type="button" onClick={closeForm} className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Close</button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Account name</span>
              <input
                required
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="OpenCode Go 1"
                className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 focus:border-lime/30 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Workspace ID or URL</span>
              <input
                required
                value={form.workspaceId}
                onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))}
                placeholder="wrk_… or https://opencode.ai/workspace/wrk_…/go"
                className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 focus:border-lime/30 focus:outline-none"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Auth cookie {editingId && <span className="normal-case tracking-normal">· leave blank to keep current</span>}
              </span>
              <input
                required={!editingId}
                type="password"
                autoComplete="off"
                value={form.authCookie}
                onChange={(event) => setForm((current) => ({ ...current, authCookie: event.target.value }))}
                placeholder="Paste the auth value, or the complete Cookie header"
                className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 font-mono text-sm focus:border-lime/30 focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                Open opencode.ai → browser DevTools → Application → Cookies → copy <code className="text-[var(--text-secondary)]">auth</code>. This read-only session is required because API keys do not expose plan quota.
              </p>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Go API key {editingId && <span className="normal-case tracking-normal">· leave blank to keep current</span>}
              </span>
              <input
                required={!editingId}
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="Validated against /zen/go/v1/models"
                className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 font-mono text-sm focus:border-lime/30 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Subscription expiry · optional</span>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 focus:border-lime/30 focus:outline-none"
              />
            </label>
          </div>

          {formError && <p className="mt-4 text-sm text-coral">{formError}</p>}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={closeForm} className="px-4 py-2.5 text-sm text-[var(--text-tertiary)]">Cancel</button>
            <button disabled={saving} className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-bg-void disabled:opacity-50">
              {saving ? "Checking & saving…" : editingId ? "Save & recheck" : "Connect & check"}
            </button>
          </div>
        </form>
      )}

      {loadError && (
        <div className="mb-5 rounded-xl border border-coral/20 bg-coral/5 px-4 py-3 text-sm text-coral">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {[0, 1].map((item) => <div key={item} className="skeleton h-[430px] rounded-xl" />)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-lime/10 text-xl text-lime">↗</div>
          <h2 className="text-lg font-bold">Connect your first OpenCode Go account</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--text-tertiary)]">
            The tracker reads the same authenticated workspace values as the OpenCode dashboard and preserves the last known-good sample if OpenCode is temporarily unavailable.
          </p>
          <button onClick={openCreate} className="mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-bg-void">Add account</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                nowMs={nowMs}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                onToggle={toggleAccount}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            Last successful check: {formatCheckedAt(lastChecked)} · countdowns update locally between polls
          </p>
        </>
      )}
    </div>
  );
}
