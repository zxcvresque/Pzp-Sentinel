"use client";

import { useCallback, useEffect, useState } from "react";
import PageTour from "@/components/PageTour";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Server {
  id: string;
  name: string;
  provider: string;
  ip: string;
  platform: string;
  username: string;
  sshPort: number;
  tags: string[];
  notes: string;
  specs: Record<string, string>;
  status: "online" | "offline";
  uptime: number; // seconds
  loadAvg: string; // e.g. "0.52, 0.38, 0.25"
  metrics: {
    cpuUsage: number;
    ramUsage: number;
    ramTotal: number;
    diskUsage: number;
    diskTotal: number;
    netIn: number;
    netOut: number;
  };
  access?: {
    status: "none" | "requested" | "granted";
    accessLevel: string | null;
    devPublicKey: string | null;
  };
  lastSeen: string; // ISO timestamp
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function usageColor(pct: number): string {
  if (pct > 80) return "var(--coral)";
  if (pct >= 50) return "var(--amber)";
  return "var(--mint)";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatGB(gb: number): string {
  return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

function sshTarget(user: string, ip: string): string {
  return ip.includes(":") ? `${user}@[${ip}]` : `${user}@${ip}`;
}

function sshPortFlag(port: number): string {
  return port && port !== 22 ? `-p ${port} ` : "";
}

function tagStyle(tag: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) % 360;
  }
  const hue = hash || 184;
  return {
    color: `hsl(${hue}, 82%, 72%)`,
    background: `hsla(${hue}, 70%, 48%, 0.12)`,
    border: `1px solid hsla(${hue}, 70%, 58%, 0.28)`,
  };
}

/* ------------------------------------------------------------------ */
/*  Usage bar component                                                */
/* ------------------------------------------------------------------ */

function UsageBar({
  label,
  pct,
  detail,
}: {
  label: string;
  pct: number;
  detail?: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = usageColor(clamped);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className="font-mono text-[11px] font-semibold" style={{ color }}>
          {Math.round(clamped)}%
          {detail && (
            <span className="font-normal text-[var(--text-tertiary)] ml-1.5">
              {detail}
            </span>
          )}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--bg-deep)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${clamped}%`,
            background: color,
            boxShadow: clamped > 80 ? `0 0 8px ${color}40` : undefined,
          }}
        />
      </div>
      {/* Threshold markers */}
      <div className="relative h-0">
        <div
          className="absolute top-[-10px] h-2"
          style={{
            left: "50%",
            width: 1,
            background: "var(--border)",
            opacity: 0.4,
          }}
        />
        <div
          className="absolute top-[-10px] h-2"
          style={{
            left: "80%",
            width: 1,
            background: "var(--border)",
            opacity: 0.4,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SSH access panel — request / pending / granted                     */
/* ------------------------------------------------------------------ */

function SshAccessPanel({ server, onChanged }: { server: Server; onChanged: () => void }) {
  const access = server.access ?? { status: "none", accessLevel: null, devPublicKey: null };
  const [showForm, setShowForm] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function submitKey() {
    const key = keyInput.trim();
    if (!key) return;
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`/api/vps/${server.id}/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devPublicKey: key }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Request failed");
      }
      setKeyInput("");
      setShowForm(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  const statusColor =
    access.status === "granted"
      ? "var(--mint)"
      : access.status === "requested"
        ? "var(--amber)"
        : "var(--coral)";
  const statusLabel =
    access.status === "granted"
      ? "✓ Access granted"
      : access.status === "requested"
        ? "Awaiting admin grant"
        : "No access";

  return (
    <div data-tour="ssh-access" className="rounded-lg px-3 py-2" style={{ background: "var(--bg-deep)" }}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          SSH Access
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {access.status !== "none" && access.devPublicKey && (
        <div className="mt-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Your submitted key
          </span>
          <code className="block min-w-0 break-all rounded bg-[var(--bg-card)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
            {access.devPublicKey}
          </code>
        </div>
      )}

      {access.status === "granted" && (
        <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] leading-relaxed">
          Your key is installed on the server. Use your matching private key to SSH in.
        </p>
      )}
      {access.status === "requested" && (
        <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] leading-relaxed">
          An admin will install your key on the box and grant access.
        </p>
      )}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
          style={
            access.status === "none"
              ? { color: "var(--rose)", background: "rgba(251,113,133,0.10)", border: "1px solid rgba(251,113,133,0.30)" }
              : { color: "var(--text-secondary)", background: "var(--bg-card)" }
          }
        >
          {access.status === "none" ? "Request access" : "Update key"}
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            placeholder="Paste your SSH public key (ssh-ed25519 AAAA... or ssh-rsa AAAA...)"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            rows={3}
            className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-active)] resize-none break-all"
          />
          {err && <p className="text-[11px] text-[var(--coral)]">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitKey}
              disabled={submitting || !keyInput.trim()}
              className="font-mono text-[10px] uppercase px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              style={{ color: "var(--bg-deep)", background: "var(--lime)" }}
            >
              {submitting ? "Submitting..." : "Submit key"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setErr("");
              }}
              className="font-mono text-[10px] uppercase px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: "var(--text-tertiary)", background: "var(--bg-card)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Server card component                                              */
/* ------------------------------------------------------------------ */

function ServerCard({ server, onChanged }: { server: Server; onChanged: () => void }) {
  const [copiedSsh, setCopiedSsh] = useState(false);
  const isOnline = server.status === "online";
  const m = server.metrics;

  const ramPct = m.ramTotal > 0 ? (m.ramUsage / m.ramTotal) * 100 : 0;
  const diskPct = m.diskTotal > 0 ? (m.diskUsage / m.diskTotal) * 100 : 0;
  const sshUser = server.username || "root";
  const sshPort = server.sshPort || 22;
  const sshCommand = `ssh ${sshPortFlag(sshPort)}${sshTarget(sshUser, server.ip)}`;

  const specEntries = Object.entries(server.specs ?? {});

  return (
    <div className="card p-4 sm:p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Status dot */}
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              background: isOnline ? "var(--mint)" : "var(--coral)",
              boxShadow: isOnline
                ? "0 0 6px rgba(52,211,153,0.4)"
                : "0 0 6px rgba(248,113,113,0.4)",
            }}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
                {server.name}
              </h3>
              {server.platform && (
                <span
                  className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                  style={{
                    color: "var(--violet)",
                    background: "rgba(167,139,250,0.12)",
                    border: "1px solid rgba(167,139,250,0.30)",
                  }}
                  title="Platform"
                >
                  {server.platform}
                </span>
              )}
            </div>
            {server.provider && (
              <span className="text-xs text-[var(--text-tertiary)]">{server.provider}</span>
            )}
            {(server.tags ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(server.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                    style={tagStyle(tag)}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full shrink-0"
          style={{
            color: isOnline ? "var(--mint)" : "var(--coral)",
            background: isOnline
              ? "rgba(52,211,153,0.08)"
              : "rgba(248,113,113,0.08)",
          }}
        >
          {server.status}
        </span>
      </div>

      {/* IP Address */}
      <div className="rounded-lg px-3 py-1.5" style={{ background: "var(--bg-deep)" }}>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
          IP Address
        </span>
        <span className="block min-w-0 break-all font-mono text-xs leading-relaxed text-[var(--text-primary)] sm:text-sm">
          {server.ip || "—"}
        </span>
      </div>

      {/* Specs — dynamic from JSON */}
      <div
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-1">
          SSH
        </span>
        <code className="block min-w-0 break-all rounded bg-[var(--bg-card)] px-2 py-1.5 font-mono text-xs text-[var(--text-secondary)]">
          {sshCommand}
        </code>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded bg-[var(--bg-card)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
            user {sshUser}
          </span>
          <span className="rounded bg-[var(--bg-card)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
            port {sshPort}
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(sshCommand);
              setCopiedSsh(true);
              setTimeout(() => setCopiedSsh(false), 2000);
            }}
            className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
            style={{
              color: copiedSsh ? "var(--mint)" : "var(--text-secondary)",
              background: "var(--bg-card)",
            }}
          >
            {copiedSsh ? "Copied SSH" : "Copy SSH"}
          </button>
        </div>
      </div>

      {/* SSH access — request / pending / granted (per-dev) */}
      <SshAccessPanel server={server} onChanged={onChanged} />

      {specEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {specEntries.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg px-3 py-2 text-center"
              style={{ background: "var(--bg-deep)" }}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
                {label}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)] font-medium break-all">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Usage bars */}
      <div className="space-y-3">
        <UsageBar label="CPU" pct={m.cpuUsage} />
        <UsageBar
          label="RAM"
          pct={ramPct}
          detail={`${formatGB(m.ramUsage)} / ${formatGB(m.ramTotal)} GB`}
        />
        <UsageBar
          label="Disk"
          pct={diskPct}
          detail={`${formatGB(m.diskUsage)} / ${formatGB(m.diskTotal)} GB`}
        />
      </div>

      {/* Network I/O */}
      <div
        className="flex items-center justify-between rounded-lg px-3 py-2.5"
        style={{ background: "var(--bg-deep)" }}
      >
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Network I/O
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            <span className="text-[var(--text-secondary)]">{"↓"}</span>{" "}
            {formatGB(m.netIn)} GB
            <span className="text-[var(--text-tertiary)] mx-2">|</span>
            <span className="text-[var(--text-secondary)]">{"↑"}</span>{" "}
            {formatGB(m.netOut)} GB
          </span>
        </div>
      </div>

      {/* Load Average */}
      {server.loadAvg && (
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Load Avg
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {server.loadAvg}
          </span>
        </div>
      )}

      {/* Footer: uptime + last seen */}
      <div
        className="flex items-center justify-between pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block">
            Uptime
          </span>
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {formatUptime(server.uptime)}
          </span>
        </div>
        <div className="text-right">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block">
            Last Seen
          </span>
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {formatTimestamp(server.lastSeen)}
          </span>
        </div>
      </div>

      {/* Notes */}
      {server.notes && (
        <div className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          {server.notes}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Request Server form                                                */
/* ------------------------------------------------------------------ */

function RequestServerForm({ onRequested }: { onRequested: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [ip, setIp] = useState("");
  const [platform, setPlatform] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const canSubmit = name.trim() && platform.trim() && ip.trim() && password.trim();

  const inputClass =
    "w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary text-sm focus:outline-none focus:border-[var(--border-active)] transition-colors";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const res = await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider: provider.trim(),
          ip: ip.trim(),
          platform: platform.trim(),
          password: password.trim(),
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit request");
      }

      setName("");
      setProvider("");
      setIp("");
      setPlatform("");
      setPassword("");
      setNotes("");
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setOpen(false);
      }, 3000);
      onRequested();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
        style={{
          color: "var(--lime)",
          background: "rgba(var(--lime-rgb, 52,211,153), 0.08)",
          border: "1px solid rgba(var(--lime-rgb, 52,211,153), 0.2)",
        }}
      >
        {open ? (
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="inline-block">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          "+ Request Server"
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="card p-4 sm:p-6 flex flex-col gap-4 col-span-full">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Request Server
            </span>
          </div>

          {success ? (
            <div
              className="rounded-lg px-4 py-3 font-mono text-xs"
              style={{
                color: "var(--lime)",
                background: "rgba(var(--lime-rgb, 52,211,153), 0.08)",
                border: "1px solid rgba(var(--lime-rgb, 52,211,153), 0.2)",
              }}
            >
              Request submitted — pending admin approval
            </div>
          ) : (
            <>
              {/* Row 1: Name, Platform, IP Address */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Server name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder="Oracle, Netcup, Hetzner..."
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  required
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder="xxx.xxx.xxx.xxx"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>

              {/* Row 2: Provider, Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Who provided it?"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className={inputClass}
                />
                <input
                  type="password"
                  placeholder="SSH password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>

              {/* Row 3: Notes */}
              <textarea
                placeholder="Any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
              />

              {error && (
                <p className="text-xs text-[var(--coral)]">{error}</p>
              )}

              {/* Row 4: Submit */}
              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="font-mono text-xs px-4 py-2.5 rounded-lg transition-colors self-start disabled:opacity-40"
                style={{
                  color: "var(--bg-deep)",
                  background: "var(--lime)",
                }}
              >
                {submitting ? "Submitting..." : "Request Server"}
              </button>
            </>
          )}
        </form>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main VPS page (Dev view)                                           */
/* ------------------------------------------------------------------ */

export default function VpsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/vps");
      if (!res.ok) throw new Error("Failed to fetch VPS data");
      const data = await res.json();
      setServers(data.servers || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch VPS data");
    } finally {
      setLoading(false);
    }
  }, []);

  /* Fetch servers + 30s polling */
  useEffect(() => {
    const initial = setTimeout(() => fetchServers(), 0);
    const interval = setInterval(() => fetchServers(), 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchServers]);

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-96 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error && servers.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold mb-6">
          VPS <span className="font-display text-lime">Stats</span>
        </h1>
        <div className="card p-4 sm:p-6 text-center">
          <p className="text-coral mb-2">Failed to load server data</p>
          <p className="text-text-tertiary text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Count summary
  const onlineCount = servers.filter((s) => s.status === "online").length;
  const offlineCount = servers.length - onlineCount;

  return (
    <div className="pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 data-tour="dev-vps-title" className="text-3xl font-extrabold">
          VPS <span className="font-display text-lime">Stats</span>
        </h1>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {servers.length > 0 && (
            <>
              <span className="font-mono text-xs text-[var(--text-secondary)]">
                <span className="text-mint font-semibold">{onlineCount}</span>{" "}
                online
              </span>
              {offlineCount > 0 && (
                <>
                  <span className="opacity-20 text-[var(--text-tertiary)]">|</span>
                  <span className="font-mono text-xs text-[var(--text-secondary)]">
                    <span className="text-coral font-semibold">{offlineCount}</span>{" "}
                    offline
                  </span>
                </>
              )}
              <span className="opacity-20 text-[var(--text-tertiary)]">|</span>
              <span className="font-mono text-xs text-[var(--text-tertiary)]">
                {servers.length} server{servers.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Request Server form (full-width below header) */}
      <div className="mb-6">
        <RequestServerForm onRequested={fetchServers} />
      </div>

      {servers.length === 0 ? (
        <div className="card p-4 sm:p-6 text-center">
          <p className="text-text-secondary mb-2">No servers available.</p>
          <p className="text-text-tertiary text-sm">
            Request a server to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} onChanged={fetchServers} />
          ))}
        </div>
      )}
      <PageTour pageKey="dev-vps" />
    </div>
  );
}
