"use client";

import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Server {
  id: string;
  name: string;
  provider: string;
  ip: string;
  platform: string;
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
/*  Server card component                                              */
/* ------------------------------------------------------------------ */

function ServerCard({ server }: { server: Server }) {
  const isOnline = server.status === "online";
  const m = server.metrics;

  const ramPct = m.ramTotal > 0 ? (m.ramUsage / m.ramTotal) * 100 : 0;
  const diskPct = m.diskTotal > 0 ? (m.diskUsage / m.diskTotal) * 100 : 0;

  const specEntries = Object.entries(server.specs ?? {});

  return (
    <div className="card p-5 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
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
            <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
              {server.name}
            </h3>
            <span className="text-xs text-[var(--text-tertiary)]">
              {server.provider}
            </span>
          </div>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded shrink-0"
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

      {/* IP Address + Platform */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            IP Address
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {server.ip || "—"}
          </span>
        </div>
        {server.platform && (
          <div
            className="rounded-lg px-3 py-2"
            style={{ background: "var(--bg-deep)" }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
              Platform
            </span>
            <span className="font-mono text-sm text-[var(--text-primary)]">
              {server.platform}
            </span>
          </div>
        )}
      </div>

      {/* Specs — dynamic from JSON */}
      {specEntries.length > 0 && (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(specEntries.length, 3)}, 1fr)`,
          }}
        >
          {specEntries.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg px-3 py-2 text-center"
              style={{ background: "var(--bg-deep)" }}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
                {label}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)] font-medium">
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
        style={{
          color: "var(--lime)",
          background: "rgba(var(--lime-rgb, 52,211,153), 0.08)",
          border: "1px solid rgba(var(--lime-rgb, 52,211,153), 0.2)",
        }}
      >
        + Request Server
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Request Server
        </span>
        <button
          type="button"
          onClick={() => { setOpen(false); setSuccess(false); setError(""); }}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)]"
            />
            <input
              type="text"
              placeholder="Provider (e.g. Oracle, Hetzner)"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)]"
            />
            <input
              type="text"
              placeholder="Platform (e.g. Ubuntu 22.04)"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)]"
            />
            <input
              type="text"
              placeholder="IP Address"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)]"
            />
          </div>
          <input
            type="password"
            placeholder="Password (SSH)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)]"
          />
          <textarea
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="font-mono text-sm px-3 py-2 rounded-lg bg-[var(--bg-deep)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--lime)] resize-none"
          />

          {error && (
            <p className="text-xs text-[var(--coral)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="font-mono text-xs px-4 py-2 rounded-lg transition-colors self-start disabled:opacity-40"
            style={{
              color: "var(--bg-deep)",
              background: "var(--lime)",
            }}
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </>
      )}
    </form>
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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* Fetch servers + 30s polling */
  useEffect(() => {
    fetchServers();
    const interval = setInterval(() => fetchServers(), 30000);
    return () => clearInterval(interval);
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
        <div className="card p-8 text-center">
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
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">
          VPS <span className="font-display text-lime">Stats</span>
        </h1>
        <div className="flex items-center gap-4">
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
          <RequestServerForm onRequested={fetchServers} />
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No servers available.</p>
          <p className="text-text-tertiary text-sm">
            Request a server to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
