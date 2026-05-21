"use client";

import { useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ServerMetrics {
  cpuUsage: number;
  ramUsage: number;
  diskUsage: number;
  bandwidthUsed: string;
  bandwidthLimit: string;
}

interface ServerSpecs {
  cpu: string;
  ram: string;
  storage: string;
}

interface Server {
  id: string;
  name: string;
  provider: string;
  ip: string;
  specs: ServerSpecs;
  status: string;
  uptime: string;
  metrics: ServerMetrics;
  lastChecked: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function usageColor(pct: number): string {
  if (pct > 80) return "var(--coral)";
  if (pct >= 50) return "var(--amber)";
  return "var(--mint)";
}

function usageBg(pct: number): string {
  if (pct > 80) return "rgba(248,113,113,0.10)";
  if (pct >= 50) return "rgba(251,191,36,0.10)";
  return "rgba(52,211,153,0.10)";
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

/* ------------------------------------------------------------------ */
/*  Usage bar component                                                */
/* ------------------------------------------------------------------ */

function UsageBar({ label, pct }: { label: string; pct: number }) {
  const color = usageColor(pct);
  const bg = usageBg(pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {label}
        </span>
        <span
          className="font-mono text-[11px] font-semibold"
          style={{ color }}
        >
          {pct}%
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--bg-deep)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: color,
            boxShadow: pct > 80 ? `0 0 8px ${color}40` : undefined,
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

      {/* IP Address */}
      <div
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
          IP Address
        </span>
        <span className="font-mono text-sm text-[var(--text-primary)]">
          {server.ip}
        </span>
      </div>

      {/* Specs */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["CPU", server.specs.cpu],
            ["RAM", server.specs.ram],
            ["Disk", server.specs.storage],
          ] as const
        ).map(([label, value]) => (
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

      {/* Usage bars */}
      <div className="space-y-3">
        <UsageBar label="CPU" pct={server.metrics.cpuUsage} />
        <UsageBar label="RAM" pct={server.metrics.ramUsage} />
        <UsageBar label="Disk" pct={server.metrics.diskUsage} />
      </div>

      {/* Bandwidth */}
      <div
        className="flex items-center justify-between rounded-lg px-3 py-2.5"
        style={{ background: "var(--bg-deep)" }}
      >
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Bandwidth
          </span>
          <span className="text-sm text-[var(--text-primary)]">
            {server.metrics.bandwidthUsed}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {" "}
            / {server.metrics.bandwidthLimit}
          </span>
        </div>
      </div>

      {/* Footer: uptime + last checked */}
      <div
        className="flex items-center justify-between pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block">
            Uptime
          </span>
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {server.uptime}
          </span>
        </div>
        <div className="text-right">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block">
            Last Checked
          </span>
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {formatTimestamp(server.lastChecked)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main VPS page                                                      */
/* ------------------------------------------------------------------ */

export default function VpsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vps")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch VPS data");
        return r.json();
      })
      .then((data) => setServers(data.servers || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

  if (error) {
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
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No servers configured.</p>
          <p className="text-text-tertiary text-sm">
            VPS agent data will appear here once connected.
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
