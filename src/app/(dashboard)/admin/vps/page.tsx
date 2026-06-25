"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Server {
  id: string;
  name: string;
  provider: string;
  ip: string;
  platform: string;
  password?: string;
  notes: string;
  approved: boolean;
  addedById: string;
  specs: Record<string, string>;
  status: "online" | "offline" | "pending";
  uptime: number;
  loadAvg: string;
  metrics: {
    cpuUsage: number;
    ramUsage: number;
    ramTotal: number;
    diskUsage: number;
    diskTotal: number;
    netIn: number;
    netOut: number;
  };
  history?: {
    week: MetricSummary;
    month: MetricSummary;
  };
  lastSeen: string;
}

interface MetricSummary {
  samples: number;
  cpuUsage: number;
  ramUsage: number;
  ramTotal: number;
  ramPct: number;
  diskUsage: number;
  diskTotal: number;
  diskPct: number;
  load1: number;
  load5: number;
  load15: number;
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

function extractSshUser(notes: string): string {
  const match = notes.match(/(?:^|\n)\s*(?:user|username)\s*[:=]\s*([^\s,;]+)/i);
  return match?.[1] || "root";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sshTarget(user: string, ip: string): string {
  return ip.includes(":") ? `${user}@[${ip}]` : `${user}@${ip}`;
}

function parseLoadAvg(loadAvg: string): number[] {
  return loadAvg
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
}

function loadStatus(loadAvg: string): { label: string; color: string; help: string } {
  const peak = Math.max(0, ...parseLoadAvg(loadAvg));
  if (peak >= 2) {
    return { label: "High", color: "var(--coral)", help: ">= 2.00" };
  }
  if (peak >= 1) {
    return { label: "Watch", color: "var(--amber)", help: "1.00-1.99" };
  }
  return { label: "Low", color: "var(--mint)", help: "< 1.00" };
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

function AverageRow({ label, summary }: { label: string; summary?: MetricSummary }) {
  if (!summary || summary.samples === 0) {
    return (
      <div className="grid grid-cols-[64px_1fr] gap-2 text-[11px]">
        <span className="font-mono uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className="font-mono text-[var(--text-tertiary)]">Collecting samples</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[64px_1fr] gap-2 text-[11px]">
      <span className="font-mono uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[var(--text-secondary)]">
        <span>CPU {summary.cpuUsage}%</span>
        <span>RAM {summary.ramPct}%</span>
        <span>Disk {summary.diskPct}%</span>
        <span>Load {summary.load1}/{summary.load5}/{summary.load15}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Approved server card (full metrics)                                */
/* ------------------------------------------------------------------ */

function ApprovedServerCard({
  server,
  onDeleteRequest,
}: {
  server: Server;
  onDeleteRequest: (id: string, name: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPw, setCopiedPw] = useState(false);
  const [copiedSsh, setCopiedSsh] = useState(false);
  const [copiedSshPass, setCopiedSshPass] = useState(false);
  const isOnline = server.status === "online";
  const m = server.metrics;

  const ramPct = m.ramTotal > 0 ? (m.ramUsage / m.ramTotal) * 100 : 0;
  const diskPct = m.diskTotal > 0 ? (m.diskUsage / m.diskTotal) * 100 : 0;
  const sshUser = extractSshUser(server.notes);
  const sshBase = `ssh ${sshTarget(sshUser, server.ip)}`;
  const sshPass = server.password
    ? `sshpass -p ${shellQuote(server.password)} ${sshBase}`
    : sshBase;
  const load = loadStatus(server.loadAvg);

  const specEntries = Object.entries(server.specs ?? {});

  return (
    <div className="card p-4 sm:p-6 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
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
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {server.name}
            </h3>
            <span className="text-xs text-[var(--text-tertiary)]">
              {server.provider}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded"
            style={{
              color: isOnline ? "var(--mint)" : "var(--coral)",
              background: isOnline
                ? "rgba(52,211,153,0.08)"
                : "rgba(248,113,113,0.08)",
            }}
          >
            {server.status}
          </span>
          <button
            onClick={() => onDeleteRequest(server.id, server.name)}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--coral)] hover:bg-[rgba(248,113,113,0.08)] transition-colors"
            title="Delete server"
            aria-label="Delete server"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* IP Address + Platform */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          className="min-w-0 rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            IP Address
          </span>
          <span className="block min-w-0 break-all font-mono text-xs leading-relaxed text-[var(--text-primary)] sm:text-sm">
            {server.ip || "—"}
          </span>
        </div>
        {server.platform && (
          <div
            className="min-w-0 rounded-lg px-3 py-2"
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

      {/* Password (admin only, show/copy) */}
      {server.password && (
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Password
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-[var(--text-primary)] flex-1 break-all">
              {showPassword ? server.password : "••••••••••••"}
            </span>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors shrink-0"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
              }}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(server.password!);
                setCopiedPw(true);
                setTimeout(() => setCopiedPw(false), 2000);
              }}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors shrink-0"
              style={{
                color: copiedPw ? "var(--mint)" : "var(--text-secondary)",
                background: "var(--bg-card)",
              }}
            >
              {copiedPw ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-1">
          SSH
        </span>
        <code className="block min-w-0 break-all rounded bg-[var(--bg-card)] px-2 py-1.5 font-mono text-xs text-[var(--text-secondary)]">
          {sshBase}
        </code>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(sshBase);
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
          {server.password && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(sshPass);
                setCopiedSshPass(true);
                setTimeout(() => setCopiedSshPass(false), 2000);
              }}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
              style={{
                color: copiedSshPass ? "var(--mint)" : "var(--text-secondary)",
                background: "var(--bg-card)",
              }}
            >
              {copiedSshPass ? "Copied sshpass" : "Copy sshpass"}
            </button>
          )}
        </div>
      </div>

      {/* Specs */}
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

      <div
        className="rounded-lg px-3 py-2.5 space-y-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block">
          Averages
        </span>
        <AverageRow label="7 day" summary={server.history?.week} />
        <AverageRow label="30 day" summary={server.history?.month} />
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Load Avg
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ color: load.color }}
            >
              {load.label}
            </span>
          </div>
          <span className="font-mono text-sm text-[var(--text-primary)]" style={{ color: load.color }}>
            {server.loadAvg}
          </span>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.08em]">
            <span className="text-[var(--mint)]">Low &lt;1</span>
            <span className="text-[var(--amber)]">Watch 1-2</span>
            <span className="text-[var(--coral)]">High 2+</span>
          </div>
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
/*  Pending server card (no metrics, approve/reject)                   */
/* ------------------------------------------------------------------ */

function PendingServerCard({
  server,
  onApprove,
  onRejectRequest,
  approving,
}: {
  server: Server;
  onApprove: (id: string) => void;
  onRejectRequest: (id: string, name: string) => void;
  approving: string | null;
}) {
  const isProcessing = approving === server.id;

  return (
    <div
      className="card p-4 sm:p-6 flex flex-col gap-4"
      style={{ border: "1px solid rgba(251,191,36,0.25)" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              background: "rgba(251,191,36,0.8)",
              boxShadow: "0 0 6px rgba(251,191,36,0.4)",
            }}
          />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {server.name}
            </h3>
            <span className="text-xs text-[var(--text-tertiary)]">
              {server.provider || "No provider"}
            </span>
          </div>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded shrink-0"
          style={{
            color: "rgba(251,191,36,1)",
            background: "rgba(251,191,36,0.08)",
          }}
        >
          Pending
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

      {/* Notes */}
      {server.notes && (
        <div className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          {server.notes}
        </div>
      )}

      {/* Requested by */}
      <div
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
          Requested By
        </span>
        <span className="font-mono text-xs text-[var(--text-secondary)]">
          {server.addedById}
        </span>
      </div>

      {/* Approve / Reject buttons */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => onApprove(server.id)}
          disabled={isProcessing}
          className="flex-1 font-mono text-xs px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
          style={{
            color: "var(--bg-deep)",
            background: "var(--lime)",
          }}
        >
          {isProcessing ? "Approving..." : "Approve"}
        </button>
        <button
          onClick={() => onRejectRequest(server.id, server.name)}
          disabled={isProcessing}
          className="flex-1 font-mono text-xs px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
          style={{
            color: "var(--coral)",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Server form                                                    */
/* ------------------------------------------------------------------ */

function AddServerForm({ onCreated }: { onCreated: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [ip, setIp] = useState("");
  const [platform, setPlatform] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim() && platform.trim() && ip.trim() && password.trim();

  const inputClass =
    "w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary text-sm focus:outline-none focus:border-[var(--border-active)] transition-colors";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

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
        throw new Error(data.error || "Failed to create server");
      }

      const data = await res.json();
      setName("");
      setProvider("");
      setIp("");
      setPlatform("");
      setPassword("");
      setNotes("");
      setOpen(false);
      onCreated(data.server?.token ?? data.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create server");
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
          "+ Add Server"
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="card p-4 sm:p-6 flex flex-col gap-4 col-span-full">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              New Server
            </span>
          </div>

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

          {/* Row 4: Submit + Cancel */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="font-mono text-xs px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
              style={{
                color: "var(--bg-deep)",
                background: "var(--lime)",
              }}
            >
              {submitting ? "Creating..." : "Create Server"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="font-mono text-xs px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
              style={{
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px solid var(--border)",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Token display (shown after creating/approving a server)            */
/* ------------------------------------------------------------------ */

function TokenDisplay({
  name,
  token,
  onDismiss,
}: {
  name: string;
  token: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="card p-4 sm:p-6 flex flex-col gap-2"
      style={{ border: "1px solid rgba(var(--lime-rgb, 52,211,153), 0.3)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Agent Token for {name} (copy now — shown once)
        </span>
        <button
          onClick={onDismiss}
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
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <code className="flex-1 font-mono text-xs text-[var(--lime)] bg-[var(--bg-deep)] px-3 py-2 rounded-lg break-all select-all">
          {token}
        </code>
        <button
          onClick={handleCopy}
          className="font-mono text-[10px] uppercase px-3 py-2 rounded-lg shrink-0 transition-colors"
          style={{
            color: copied ? "var(--mint)" : "var(--text-secondary)",
            background: "var(--bg-deep)",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Admin VPS page                                                */
/* ------------------------------------------------------------------ */

export default function AdminVpsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenDisplay, setTokenDisplay] = useState<{ name: string; token: string } | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    id: string;
    name: string;
    action: "delete" | "reject";
    loading: boolean;
  }>({ open: false, id: "", name: "", action: "delete", loading: false });

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/vps?all=true", { cache: "no-store" });
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

  async function handleDelete(id: string) {
    try {
      const res = await fetch("/api/vps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      fetchServers();
    }
  }

  async function handleApprove(id: string) {
    setApproving(id);
    try {
      const res = await fetch("/api/vps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve" }),
      });
      if (!res.ok) throw new Error("Approve failed");
      const data = await res.json();
      const server = servers.find((s) => s.id === id);
      if (data.token) {
        setTokenDisplay({ name: server?.name || "Server", token: data.token });
      }
      fetchServers();
    } catch {
      fetchServers();
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(id: string) {
    try {
      const res = await fetch("/api/vps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reject" }),
      });
      if (!res.ok) throw new Error("Reject failed");
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch {
      fetchServers();
    }
  }

  function requestDelete(id: string, name: string) {
    setConfirmState({ open: true, id, name, action: "delete", loading: false });
  }

  function requestReject(id: string, name: string) {
    setConfirmState({ open: true, id, name, action: "reject", loading: false });
  }

  async function handleConfirm() {
    setConfirmState((s) => ({ ...s, loading: true }));
    if (confirmState.action === "delete") {
      await handleDelete(confirmState.id);
    } else {
      await handleReject(confirmState.id);
    }
    setConfirmState({ open: false, id: "", name: "", action: "delete", loading: false });
  }

  function handleCreated(token: string) {
    setTokenDisplay({ name: "New Server", token });
    fetchServers();
  }

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

  const approvedServers = servers.filter((s) => s.approved);
  const pendingServers = servers.filter((s) => !s.approved);
  const onlineCount = approvedServers.filter((s) => s.status === "online").length;
  const offlineCount = approvedServers.filter((s) => s.status === "offline").length;

  return (
    <div className="pb-20 md:pb-0">
      <ConfirmDialog
        open={confirmState.open}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
        onConfirm={handleConfirm}
        title={confirmState.action === "delete" ? `Delete "${confirmState.name}"?` : `Reject "${confirmState.name}"?`}
        message="This cannot be undone"
        confirmLabel={confirmState.action === "delete" ? "Delete" : "Reject"}
        variant="danger"
        loading={confirmState.loading}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-3xl font-extrabold">
          VPS <span className="font-display text-lime">Stats</span>
          <span className="text-sm font-normal text-[var(--text-tertiary)] ml-3">Admin</span>
        </h1>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {approvedServers.length > 0 && (
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
                {approvedServers.length} server{approvedServers.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
          {pendingServers.length > 0 && (
            <>
              <span className="opacity-20 text-[var(--text-tertiary)]">|</span>
              <span className="font-mono text-xs" style={{ color: "rgba(251,191,36,1)" }}>
                <span className="font-semibold">{pendingServers.length}</span>{" "}
                pending
              </span>
            </>
          )}
        </div>
      </div>

      {/* Add Server form (full-width below header) */}
      <div className="mb-6">
        <AddServerForm onCreated={handleCreated} />
      </div>

      {/* Token display (shown after creating/approving) */}
      {tokenDisplay && (
        <div className="mb-5">
          <TokenDisplay
            name={tokenDisplay.name}
            token={tokenDisplay.token}
            onDismiss={() => setTokenDisplay(null)}
          />
        </div>
      )}

      {/* Pending servers section */}
      {pendingServers.length > 0 && (
        <div className="mb-8">
          <h2
            className="font-mono text-xs uppercase tracking-[0.12em] mb-4 px-1"
            style={{ color: "rgba(251,191,36,1)" }}
          >
            Pending Approval ({pendingServers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {pendingServers.map((server) => (
              <PendingServerCard
                key={server.id}
                server={server}
                onApprove={handleApprove}
                onRejectRequest={requestReject}
                approving={approving}
              />
            ))}
          </div>
        </div>
      )}

      {/* Approved servers section */}
      {approvedServers.length === 0 && pendingServers.length === 0 ? (
        <div className="card p-4 sm:p-6 text-center">
          <p className="text-text-secondary mb-2">No servers registered.</p>
          <p className="text-text-tertiary text-sm">
            Use the button above to add a server.
          </p>
        </div>
      ) : approvedServers.length > 0 ? (
        <>
          {pendingServers.length > 0 && (
            <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-4 px-1">
              Active Servers ({approvedServers.length})
            </h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {approvedServers.map((server) => (
              <ApprovedServerCard
                key={server.id}
                server={server}
                onDeleteRequest={requestDelete}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
