"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
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
  username: string;
  sshPort: number;
  password?: string;
  sshKeyFileUrl?: string | null;
  sshKeyFileName?: string | null;
  accessPublicKeys?: string | null;
  tags: string[];
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

function sshPortFlag(port: number): string {
  return port && port !== 22 ? `-p ${port} ` : "";
}

function tagStyle(tag: string): CSSProperties {
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

function parseTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function parsePublicKeys(value?: string | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function authorizedKeysCommand(username: string, keys: string[]): string {
  const home = username === "root" ? "/root" : `/home/${username}`;
  const quotedKeys = keys.map(shellQuote).join(" ");
  return [
    `sudo install -d -m 700 -o ${shellQuote(username)} -g ${shellQuote(username)} ${shellQuote(`${home}/.ssh`)}`,
    `printf '%s\\n' ${quotedKeys} | sudo tee -a ${shellQuote(`${home}/.ssh/authorized_keys`)} >/dev/null`,
    `sudo chown ${shellQuote(username)}:${shellQuote(username)} ${shellQuote(`${home}/.ssh/authorized_keys`)}`,
    `sudo chmod 600 ${shellQuote(`${home}/.ssh/authorized_keys`)}`,
  ].join("\n");
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
  const [copiedKeysCommand, setCopiedKeysCommand] = useState(false);
  const [showAverages, setShowAverages] = useState(false);
  const isOnline = server.status === "online";
  const m = server.metrics;

  const ramPct = m.ramTotal > 0 ? (m.ramUsage / m.ramTotal) * 100 : 0;
  const diskPct = m.diskTotal > 0 ? (m.diskUsage / m.diskTotal) * 100 : 0;
  const sshUser = server.username || extractSshUser(server.notes);
  const sshPort = server.sshPort || 22;
  const sshBase = `ssh ${sshPortFlag(sshPort)}${sshTarget(sshUser, server.ip)}`;
  const sshWithKey = server.sshKeyFileName
    ? `ssh -i ${shellQuote(server.sshKeyFileName)} ${sshPortFlag(sshPort)}${sshTarget(sshUser, server.ip)}`
    : sshBase;
  const sshPass = server.password
    ? `sshpass -p ${shellQuote(server.password)} ${sshBase}`
    : sshBase;
  const publicKeys = parsePublicKeys(server.accessPublicKeys);
  const keysCommand = publicKeys.length > 0 ? authorizedKeysCommand(sshUser, publicKeys) : "";
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
            {(server.tags ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
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
      <div className="grid grid-cols-2 gap-2">
        <div
          className="col-span-2 min-w-0 rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            IP Address
          </span>
          <span className="block min-w-0 break-all font-mono text-xs leading-relaxed text-[var(--text-primary)] sm:text-sm">
            {server.ip || "—"}
          </span>
        </div>
        <div
          className="min-w-0 rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Username
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)] break-all">
            {sshUser}
          </span>
        </div>
        <div
          className="min-w-0 rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            SSH Port
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {sshPort}
          </span>
        </div>
        {server.platform && (
          <div
            className="col-span-2 min-w-0 rounded-lg px-3 py-2 sm:col-span-1"
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
          {server.sshKeyFileName ? sshWithKey : sshBase}
        </code>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(server.sshKeyFileName ? sshWithKey : sshBase);
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
          {server.sshKeyFileUrl && (
            <a
              href={server.sshKeyFileUrl}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
              }}
            >
              Download key
            </a>
          )}
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

      {publicKeys.length > 0 && (
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Dev access keys
            </span>
            <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--mint)] bg-[rgba(52,211,153,0.08)]">
              {publicKeys.length} key{publicKeys.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Password/private key stays admin-only. Install these public keys on the VPS, then share only host, port, and username.
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(keysCommand);
              setCopiedKeysCommand(true);
              setTimeout(() => setCopiedKeysCommand(false), 2000);
            }}
            className="mt-2 font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
            style={{
              color: copiedKeysCommand ? "var(--mint)" : "var(--text-secondary)",
              background: "var(--bg-card)",
            }}
          >
            {copiedKeysCommand ? "Copied install command" : "Copy install command"}
          </button>
        </div>
      )}

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
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-deep)" }}
      >
        <button
          type="button"
          onClick={() => setShowAverages((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Averages
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--mint)] bg-[rgba(52,211,153,0.08)]">
              7 day
            </span>
            <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--lime)] bg-[rgba(111,209,215,0.08)]">
              30 day
            </span>
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {showAverages ? "Hide" : "Show"}
            </span>
          </span>
        </button>
        {showAverages && (
          <div className="mt-2 space-y-2">
            <AverageRow label="7 day" summary={server.history?.week} />
            <AverageRow label="30 day" summary={server.history?.month} />
          </div>
        )}
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
            {(server.tags ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
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
      <div className="grid grid-cols-2 gap-2">
        <div
          className="col-span-2 rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            IP Address
          </span>
          <span className="block min-w-0 break-all font-mono text-xs leading-relaxed text-[var(--text-primary)] sm:text-sm">
            {server.ip || "—"}
          </span>
        </div>
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Username
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)] break-all">
            {server.username || "root"}
          </span>
        </div>
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            SSH Port
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {server.sshPort || 22}
          </span>
        </div>
        {server.platform && (
          <div
            className="col-span-2 rounded-lg px-3 py-2 sm:col-span-1"
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
  const [username, setUsername] = useState("root");
  const [sshPort, setSshPort] = useState("22");
  const [password, setPassword] = useState("");
  const [sshKeyFile, setSshKeyFile] = useState<File | null>(null);
  const [sshKeyFileName, setSshKeyFileName] = useState("");
  const [accessPublicKeys, setAccessPublicKeys] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [devs, setDevs] = useState<{ id: string; name: string }[]>([]);
  const [shareWith, setShareWith] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) =>
        setDevs(
          (d.users || [])
            .filter((u: { roles: string[] }) => u.roles.includes("DEV"))
            .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })),
        ),
      )
      .catch(() => {});
  }, [open]);

  const parsedPort = Number(sshPort);
  const tags = parseTagsInput(tagsInput);
  const hasAuth = Boolean(password.trim() || sshKeyFile);
  const canSubmit = Boolean(
    name.trim() &&
    ip.trim() &&
    username.trim() &&
    Number.isInteger(parsedPort) &&
    parsedPort > 0 &&
    parsedPort <= 65535 &&
    hasAuth,
  );

  const inputClass =
    "w-full bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-2.5 text-text-primary placeholder:text-text-tertiary text-sm focus:outline-none focus:border-[var(--border-active)] transition-colors";
  const labelClass =
    "block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mb-1";
  const sectionClass =
    "font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]";

  async function uploadKeyFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/vps/key-upload", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to upload SSH key file");
    }
    return {
      url: String(data.url ?? ""),
      fileName: String(data.fileName ?? file.name),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

    try {
      let uploadedKey: { url: string; fileName: string } | null = null;
      if (sshKeyFile) {
        uploadedKey = await uploadKeyFile(sshKeyFile);
      }

      const res = await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider: provider.trim(),
          ip: ip.trim(),
          platform: platform.trim(),
          username: username.trim(),
          sshPort: parsedPort,
          password: password.trim(),
          sshKeyFileUrl: uploadedKey?.url ?? "",
          sshKeyFileName: uploadedKey?.fileName ?? sshKeyFileName,
          accessPublicKeys: accessPublicKeys.trim(),
          tags,
          notes: notes.trim(),
          shareWith,
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
      setUsername("root");
      setSshPort("22");
      setPassword("");
      setSshKeyFile(null);
      setSshKeyFileName("");
      setAccessPublicKeys("");
      setTagsInput("");
      setNotes("");
      setShareWith([]);
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
        <form onSubmit={handleSubmit} className="card p-4 sm:p-5 flex flex-col gap-4 col-span-full">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              New Server
            </span>
          </div>

          <div className="space-y-3">
            <span className={sectionClass}>Connection</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
              <label className="xl:col-span-3">
                <span className={labelClass}>Name for the server</span>
                <input
                  type="text"
                  placeholder="Pzp Netcup"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-3">
                <span className={labelClass}>IP address</span>
                <input
                  type="text"
                  placeholder="IPv4 or IPv6"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-2">
                <span className={labelClass}>Username</span>
                <input
                  type="text"
                  placeholder="root"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-2">
                <span className={labelClass}>SSH port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-2">
                <span className={labelClass}>Platform</span>
                <input
                  type="text"
                  placeholder="Netcup, Oracle..."
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <span className={sectionClass}>Access</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
              <label className="xl:col-span-4">
                <span className={labelClass}>Password</span>
                <input
                  type="password"
                  placeholder="SSH password, if using password login"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-4">
                <span className={labelClass}>SSH key file</span>
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.size > 5 * 1024 * 1024) {
                      setError("SSH key file must be 5MB or smaller");
                      e.currentTarget.value = "";
                      return;
                    }
                    setError("");
                    setSshKeyFile(file);
                    setSshKeyFileName(file?.name ?? "");
                  }}
                  className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-[var(--bg-card)] file:px-2 file:py-1 file:font-mono file:text-[10px] file:uppercase file:text-[var(--text-secondary)]`}
                />
                <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
                  Optional. Stored in Telegram as a document. Max 5MB.
                </span>
              </label>
              <label className="xl:col-span-4">
                <span className={labelClass}>Tags</span>
                <input
                  type="text"
                  placeholder="prod, netcup, donated"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className={inputClass}
                />
                {tags.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                        style={tagStyle(tag)}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </label>
              <label className="xl:col-span-12">
                <span className={labelClass}>Dev SSH public keys</span>
                <textarea
                  placeholder="Paste one ssh-ed25519 or ssh-rsa public key per line"
                  value={accessPublicKeys}
                  onChange={(e) => setAccessPublicKeys(e.target.value)}
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
                <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
                  These are safe-to-share public keys. Sentinel will show an install command; passwords/private keys stay hidden unless explicitly copied by an admin.
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <span className={sectionClass}>Ownership</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Who provided it?</span>
                <input
                  type="text"
                  placeholder="Provider, donor, or account owner"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label>
                <span className={labelClass}>Additional notes</span>
                <textarea
                  placeholder="Purpose, limits, renewal context..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <span className={sectionClass}>Share credentials (optional)</span>
            <p className="font-mono text-[10px] text-[var(--text-tertiary)] leading-relaxed">
              Give selected developers FULL access to this server&apos;s stored credentials right away. Leave empty and devs can request public-key access themselves.
            </p>
            <div className="flex flex-wrap gap-2">
              {devs.map((dev) => {
                const active = shareWith.includes(dev.id);
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() =>
                      setShareWith((prev) =>
                        prev.includes(dev.id) ? prev.filter((x) => x !== dev.id) : [...prev, dev.id],
                      )
                    }
                    className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors"
                    style={
                      active
                        ? { color: "var(--bg-deep)", background: "var(--coral)", borderColor: "var(--coral)" }
                        : { color: "var(--text-secondary)", borderColor: "var(--border)", background: "transparent" }
                    }
                  >
                    {dev.name}
                  </button>
                );
              })}
              {devs.length === 0 && (
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">No developers found</span>
              )}
            </div>
          </div>

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
              {submitting ? (sshKeyFile ? "Uploading..." : "Creating...") : "Create Server"}
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
        message={
          confirmState.action === "delete"
            ? "This cannot be undone. Linked vault credentials and any developer access to them are also removed."
            : "This cannot be undone"
        }
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
