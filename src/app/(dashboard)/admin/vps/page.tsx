"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageTour from "@/components/PageTour";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import ServicesNav from "@/components/ServicesNav";
import TgUser from "@/components/TgUser";
import {
  CUSTOM_REPEAT_UNITS,
  SERVICE_FREQUENCY_OPTIONS,
  type CustomRepeatUnit,
  type ServiceFrequency,
} from "@/lib/service-billing";

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
  hasPassword?: boolean;
  hasSshKeyFile?: boolean;
  sshKeyFileUrl?: string | null;
  sshKeyFileName?: string | null;
  accessPublicKeys?: string | null;
  token?: string;
  tags: string[];
  notes: string;
  approved: boolean;
  alertsEnabled: boolean;
  addedById: string;
  // ADMIN-ONLY (never sent to devs): plan link + billing/duration.
  planLink?: string | null;
  subscription?: Subscription | null;
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
  processHealth?: Array<{ name?: string; pm2_env?: { status?: string } }> | null;
  releaseVersion?: string | null;
  projects?: Array<{ id: string; name: string }>;
  maintainers?: Array<{ id: string; name: string; photoUrl?: string | null; telegramUser?: string | null }>;
}

interface Subscription {
  mode: "LIFETIME" | "ONE_TIME" | "SUBSCRIPTION";
  frequency: ServiceFrequency | "ONE_TIME" | "LIFETIME";
  customRepeatEvery: number | null;
  customRepeatUnit: CustomRepeatUnit | null;
  price: number | null;
  currency: "INR" | "USD" | null;
  expiryDate: string | null;
  autoRenew: boolean;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | null;
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
  return shellQuote(ip.includes(":") ? `${user}@[${ip}]` : `${user}@${ip}`);
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

const CURRENCY_SYMBOL: Record<string, string> = { INR: "₹", USD: "$" };
const FREQ_SHORT: Record<string, string> = { WEEKLY: "wk", MONTHLY: "mo", QUARTERLY: "quarter", HALF_YEARLY: "6 mo", YEARLY: "yr", ONE_TIME: "once" };

function subscriptionFrequencyLabel(sub: Subscription): string {
  if (sub.frequency === "CUSTOM" && sub.customRepeatEvery && sub.customRepeatUnit) {
    const unit = sub.customRepeatUnit.toLowerCase();
    return `Every ${sub.customRepeatEvery} ${unit}${sub.customRepeatEvery === 1 ? "" : "s"}`;
  }
  return SERVICE_FREQUENCY_OPTIONS.find((option) => option.value === sub.frequency)?.label
    || sub.frequency.toLowerCase().replaceAll("_", " ");
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  const sym = CURRENCY_SYMBOL[currency ?? "INR"] ?? "";
  const n = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  return `${sym}${n}`;
}

function formatRate(sub: Subscription): string {
  const money = formatMoney(sub.price, sub.currency);
  if (sub.mode !== "SUBSCRIPTION") return money;
  return `${money} / ${FREQ_SHORT[sub.frequency] ?? subscriptionFrequencyLabel(sub)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Public origin agents report to (falls back to prod when viewed on localhost). */
function sentinelOrigin(): string {
  const fallback = "https://sentinel.piratezparty.com";
  if (typeof window === "undefined") return fallback;
  const o = window.location.origin;
  return o && !/localhost|127\.0\.0\.1/.test(o) ? o : fallback;
}

/** Full copy-paste install one-liner for a server's agent token. */
function installCommand(token: string): string {
  return `curl -fsSL ${shellQuote(`${sentinelOrigin()}/install.sh`)} | sudo bash -s -- --token ${shellQuote(token)}`;
}

/** Days until expiry (negative = already expired). */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/*  Pill — compact status chip (reuses the ONLINE badge styling)       */
/* ------------------------------------------------------------------ */

function Pill({
  children,
  color,
  bg,
  border,
  title,
}: {
  children: React.ReactNode;
  color: string;
  bg?: string;
  border?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
      style={{ color, background: bg ?? "transparent", border }}
    >
      {children}
    </span>
  );
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
  onEditRequest,
  onRenew,
  onRefundRequest,
}: {
  server: Server;
  onDeleteRequest: (id: string, name: string) => void;
  onEditRequest: (server: Server) => void;
  onRenew: (id: string) => Promise<void>;
  onRefundRequest: (server: Server) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState("");
  const [revealedKeyUrl, setRevealedKeyUrl] = useState("");
  const [copiedPw, setCopiedPw] = useState(false);
  const [copiedSsh, setCopiedSsh] = useState(false);
  const [copiedSshPass, setCopiedSshPass] = useState(false);
  const [copiedKeysCommand, setCopiedKeysCommand] = useState(false);
  const [showAverages, setShowAverages] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const isOnline = server.status === "online";
  const m = server.metrics;
  const sub = server.subscription ?? null;
  const expDays = daysUntil(sub?.expiryDate);

  const ramPct = m.ramTotal > 0 ? (m.ramUsage / m.ramTotal) * 100 : 0;
  const diskPct = m.diskTotal > 0 ? (m.diskUsage / m.diskTotal) * 100 : 0;
  const sshUser = server.username || extractSshUser(server.notes);
  const sshPort = server.sshPort || 22;
  const sshBase = `ssh ${sshPortFlag(sshPort)}${sshTarget(sshUser, server.ip)}`;
  const sshWithKey = server.sshKeyFileName
    ? `ssh -i ${shellQuote(server.sshKeyFileName)} ${sshPortFlag(sshPort)}${sshTarget(sshUser, server.ip)}`
    : sshBase;
  const publicKeys = parsePublicKeys(server.accessPublicKeys);
  const keysCommand = publicKeys.length > 0 ? authorizedKeysCommand(sshUser, publicKeys) : "";
  const load = loadStatus(server.loadAvg);

  const specEntries = Object.entries(server.specs ?? {});

  async function revealSecret(field: "PASSWORD" | "PRIVATE_KEY", purpose: "REVEAL" | "COPY" = "REVEAL") {
    const response = await fetch(`/api/vps/${server.id}/reveal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, purpose }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Could not reveal secret");
    return String(data.value || "");
  }

  return (
    <div className="card p-4 sm:p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
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
                <Pill
                  color="var(--violet)"
                  bg="rgba(167,139,250,0.12)"
                  border="1px solid rgba(167,139,250,0.30)"
                  title="Platform"
                >
                  {server.platform}
                </Pill>
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
            {(server.projects?.length || server.maintainers?.length) ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                <span>{server.projects?.map((project) => project.name).join(", ") || "Unassigned project"}</span>
                {server.maintainers?.map((maintainer) => (
                  <TgUser
                    key={maintainer.id}
                    name={maintainer.name}
                    photoUrl={maintainer.photoUrl}
                    telegramUser={maintainer.telegramUser}
                    size={18}
                    nameClassName="!text-[10px] !text-[var(--text-secondary)]"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Pill
            color={isOnline ? "var(--mint)" : "var(--coral)"}
            bg={isOnline ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)"}
          >
            {server.status}
          </Pill>
          <button
            data-tour="vps-edit"
            onClick={() => onEditRequest(server)}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--lime)] hover:bg-[rgba(111,209,215,0.08)] transition-colors"
            title="Edit server"
            aria-label="Edit server"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path
                d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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

      {(server.releaseVersion || server.processHealth?.length) && (
        <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-deep)" }}>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Deployment &amp; processes</span>
          {server.releaseVersion && <div className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">Release {server.releaseVersion}</div>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(server.processHealth || []).map((process, index) => {
              const status = process.pm2_env?.status || "unknown";
              return <Pill key={`${process.name || "process"}-${index}`} color={status === "online" ? "var(--mint)" : "var(--coral)"} bg={status === "online" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)"}>{process.name || "process"}: {status}</Pill>;
            })}
          </div>
        </div>
      )}

      {/* Connection: IP (full width) + Username / SSH Port */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className="col-span-2 min-w-0 rounded-lg px-3 py-1.5"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            IP Address
          </span>
          <span className="block min-w-0 break-all font-mono text-xs leading-relaxed text-[var(--text-primary)] sm:text-sm">
            {server.ip || "—"}
          </span>
        </div>
        <div
          className="min-w-0 rounded-lg px-3 py-1.5"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Username
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)] break-all">
            {sshUser}
          </span>
        </div>
        <div
          className="min-w-0 rounded-lg px-3 py-1.5"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            SSH Port
          </span>
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {sshPort}
          </span>
        </div>
      </div>

      {/* Plan & billing (admin-only). Hidden when no plan/subscription set. */}
      {(server.planLink || sub) && (
        <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-deep)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Plan &amp; Duration
            </span>
            {server.planLink && (
              <a
                href={server.planLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--lime)] bg-[rgba(111,209,215,0.10)] hover:bg-[rgba(111,209,215,0.18)] transition-colors"
              >
                Open plan ↗
              </a>
            )}
          </div>
          {sub ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {sub.mode === "LIFETIME" ? (
                  <Pill color="var(--violet)" bg="rgba(167,139,250,0.12)" border="1px solid rgba(167,139,250,0.30)">
                    Lifetime
                  </Pill>
                ) : sub.mode === "ONE_TIME" ? (
                  <Pill color="var(--blue)" bg="rgba(96,165,250,0.12)" border="1px solid rgba(96,165,250,0.30)">
                    One-time
                  </Pill>
                ) : (
                  <Pill color="var(--lime)" bg="rgba(111,209,215,0.10)">
                    {subscriptionFrequencyLabel(sub)}
                  </Pill>
                )}
                {sub.autoRenew && (
                  <Pill color="var(--mint)" bg="rgba(52,211,153,0.08)" title="Auto-renews each cycle">
                    Auto-renew
                  </Pill>
                )}
                {sub.status === "CANCELLED" && (
                  <Pill color="var(--text-tertiary)" bg="var(--bg-card)">Cancelled</Pill>
                )}
                {sub.expiryDate && (
                  <Pill
                    color={expDays != null && expDays <= 7 ? "var(--amber)" : "var(--text-secondary)"}
                    bg={expDays != null && expDays <= 7 ? "rgba(251,191,36,0.10)" : "var(--bg-card)"}
                    title={expDays != null ? `${expDays} day(s) left` : undefined}
                  >
                    {expDays != null && expDays < 0 ? "Expired " : "Expires "}{formatDate(sub.expiryDate)}
                  </Pill>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {formatRate(sub)}
                </span>
                <div className="flex items-center gap-1.5">
                  {sub.mode === "SUBSCRIPTION" && sub.status !== "CANCELLED" && (
                    <button
                      type="button"
                      disabled={renewing}
                      onClick={async () => {
                        setRenewing(true);
                        try {
                          await onRenew(server.id);
                        } finally {
                          setRenewing(false);
                        }
                      }}
                      className="font-mono text-[10px] uppercase px-2.5 py-1 rounded transition-colors disabled:opacity-40"
                      style={{ color: "var(--lime)", background: "rgba(111,209,215,0.10)" }}
                      title="Request approval for one more billing cycle"
                    >
                      {renewing ? "Requesting…" : "Request renewal"}
                    </button>
                  )}
                  {sub.status !== "CANCELLED" && (sub.price ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => onRefundRequest(server)}
                      className="font-mono text-[10px] uppercase px-2.5 py-1 rounded transition-colors"
                      style={{ color: "var(--coral)", background: "rgba(248,113,113,0.08)" }}
                      title="Credit the rate back to the balance and cancel this plan"
                    >
                      Refund
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-1 font-mono text-[11px] text-[var(--text-tertiary)]">No billing set</p>
          )}
        </div>
      )}

      {/* Password (admin only, show/copy) */}
      {server.hasPassword && (
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: "var(--bg-deep)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] block mb-0.5">
            Password
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-[var(--text-primary)] flex-1 break-all">
              {showPassword ? revealedPassword : "••••••••••••"}
            </span>
            <button
              type="button"
              onClick={async () => {
                if (showPassword) return setShowPassword(false);
                const value = revealedPassword || await revealSecret("PASSWORD");
                setRevealedPassword(value);
                setShowPassword(true);
              }}
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
              onClick={async () => {
                const value = await revealSecret("PASSWORD", "COPY");
                await navigator.clipboard.writeText(value);
                setRevealedPassword(value);
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
          {server.hasSshKeyFile && !revealedKeyUrl && (
            <button
              type="button"
              onClick={async () => setRevealedKeyUrl(await revealSecret("PRIVATE_KEY"))}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
              }}
            >
              Reveal key link
            </button>
          )}
          {revealedKeyUrl && (
            <a href={revealedKeyUrl} className="font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors" style={{ color: "var(--text-secondary)", background: "var(--bg-card)" }}>Download key</a>
          )}
          {server.hasPassword && (
            <button
              type="button"
              onClick={async () => {
                const password = revealedPassword || await revealSecret("PASSWORD", "COPY");
                setRevealedPassword(password);
                await navigator.clipboard.writeText(`sshpass -p ${shellQuote(password)} ${sshBase}`);
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

      {server.token && (
        <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-deep)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Agent install
            </span>
            <button
              type="button"
              onClick={() => setShowInstall((v) => !v)}
              className="font-mono text-[10px] uppercase px-2 py-0.5 rounded transition-colors"
              style={{ color: "var(--text-secondary)", background: "var(--bg-card)" }}
            >
              {showInstall ? "Hide" : "Show command"}
            </button>
          </div>
          {showInstall && (
            <>
              <code className="mt-2 block min-w-0 break-all rounded bg-[var(--bg-card)] px-2 py-1.5 font-mono text-[11px] text-[var(--lime)] select-all">
                {installCommand(server.token)}
              </code>
              <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                Run on the VPS as root. Re-running with the current token fixes a 403 / offline agent (e.g. after re-adding the server).
              </p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(installCommand(server.token!));
                  setCopiedInstall(true);
                  setTimeout(() => setCopiedInstall(false), 2000);
                }}
                className="mt-2 font-mono text-[10px] uppercase px-2 py-1 rounded transition-colors"
                style={{ color: copiedInstall ? "var(--mint)" : "var(--text-secondary)", background: "var(--bg-card)" }}
              >
                {copiedInstall ? "Copied" : "Copy command"}
              </button>
            </>
          )}
        </div>
      )}

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
            <Pill color={load.color} bg={`color-mix(in srgb, ${load.color} 10%, transparent)`} title={load.help}>
              {load.label}
            </Pill>
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

function ServerForm({
  mode,
  initial,
  onCreated,
  onClose,
  existingTags = [],
}: {
  mode: "add" | "edit";
  initial?: Server | null;
  onCreated: (token?: string) => void;
  onClose?: () => void;
  existingTags?: string[];
}) {
  const isEdit = mode === "edit";
  const initSub = initial?.subscription ?? null;
  const [open, setOpen] = useState(isEdit);
  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [ip, setIp] = useState(initial?.ip ?? "");
  const [platform, setPlatform] = useState(initial?.platform ?? "");
  const [username, setUsername] = useState(initial?.username ?? "root");
  const [sshPort, setSshPort] = useState(String(initial?.sshPort ?? 22));
  const [password, setPassword] = useState("");
  const [sshKeyFile, setSshKeyFile] = useState<File | null>(null);
  const [sshKeyFileName, setSshKeyFileName] = useState(initial?.sshKeyFileName ?? "");
  const [accessPublicKeys, setAccessPublicKeys] = useState(initial?.accessPublicKeys ?? "");
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Plan link + duration/billing (admin-only).
  const [planLink, setPlanLink] = useState(initial?.planLink ?? "");
  const [durationMode, setDurationMode] = useState<"NONE" | "LIFETIME" | "ONE_TIME" | "SUBSCRIPTION">(
    initSub ? initSub.mode : "NONE",
  );
  const [price, setPrice] = useState(initSub?.price != null ? String(initSub.price) : "");
  const [currency, setCurrency] = useState<"INR" | "USD">((initSub?.currency as "INR" | "USD") ?? "INR");
  const initialFrequency = initSub && SERVICE_FREQUENCY_OPTIONS.some((option) => option.value === initSub.frequency)
    ? initSub.frequency as ServiceFrequency
    : "MONTHLY";
  const [frequency, setFrequency] = useState<ServiceFrequency>(initialFrequency);
  const [customRepeatEvery, setCustomRepeatEvery] = useState(initSub?.customRepeatEvery ? String(initSub.customRepeatEvery) : "1");
  const [customRepeatUnit, setCustomRepeatUnit] = useState<CustomRepeatUnit>(initSub?.customRepeatUnit ?? "MONTH");
  const [expiryDate, setExpiryDate] = useState(toDateInput(initSub?.expiryDate));
  const [autoRenew, setAutoRenew] = useState(initSub?.autoRenew ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [devs, setDevs] = useState<{ id: string; name: string; photoUrl?: string | null; telegramUser?: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>(initial?.projects?.map((project) => project.id) ?? []);
  const [maintainerIds, setMaintainerIds] = useState<string[]>(initial?.maintainers?.map((maintainer) => maintainer.id) ?? []);
  const [alertsEnabled, setAlertsEnabled] = useState(initial?.alertsEnabled ?? false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/users").then((r) => (r.ok ? r.json() : { users: [] })),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : { projects: [] })),
    ])
      .then(([d, projectData]) => {
        setDevs(
          (d.users || [])
            .filter((u: { roles: string[] }) => u.roles.includes("DEV"))
            .map((u: { id: string; name: string; photoUrl?: string | null; telegramUser?: string | null }) => ({
              id: u.id,
              name: u.name,
              photoUrl: u.photoUrl,
              telegramUser: u.telegramUser,
            })),
        );
        setProjects((projectData.projects || []).map((project: { id: string; name: string }) => ({ id: project.id, name: project.name })));
      })
      .catch(() => {});
  }, [open]);

  const parsedPort = Number(sshPort);
  const tags = parseTagsInput(tagsInput);
  const hasAuth = Boolean(password.trim() || sshKeyFile);
  const priceNum = Number(price);
  const customCycleValid = frequency !== "CUSTOM" || (Number.isInteger(Number(customRepeatEvery)) && Number(customRepeatEvery) > 0);
  const billingValid = durationMode === "NONE" || (Number.isFinite(priceNum) && priceNum > 0 && customCycleValid);
  const canSubmit = Boolean(
    name.trim() &&
    ip.trim() &&
    username.trim() &&
    Number.isInteger(parsedPort) &&
    parsedPort > 0 &&
    parsedPort <= 65535 &&
    (isEdit || hasAuth) &&
    billingValid,
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

      const duration =
        durationMode === "NONE"
          ? null
          : durationMode === "LIFETIME"
          ? { mode: "LIFETIME", price: priceNum, currency }
          : durationMode === "ONE_TIME"
          ? { mode: "ONE_TIME", price: priceNum, currency, expiryDate: expiryDate || null }
          : {
              mode: "SUBSCRIPTION",
              price: priceNum,
              currency,
              frequency,
              customRepeatEvery: frequency === "CUSTOM" ? Number(customRepeatEvery) : null,
              customRepeatUnit: frequency === "CUSTOM" ? customRepeatUnit : null,
              expiryDate: expiryDate || null,
              autoRenew,
            };

      const res = await fetch("/api/vps", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { id: initial!.id, action: "update" } : {}),
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
          planLink: planLink.trim(),
          duration,
          projectIds,
          maintainerIds,
          alertsEnabled,
          ...(isEdit ? {} : { shareWith }),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || (isEdit ? "Failed to update server" : "Failed to create server"));
      }

      const data = await res.json().catch(() => ({}));
      if (isEdit) {
        onClose?.();
        onCreated();
        return;
      }
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
      setProjectIds([]);
      setMaintainerIds([]);
      setAlertsEnabled(false);
      setPlanLink("");
      setDurationMode("NONE");
      setPrice("");
      setCurrency("INR");
      setFrequency("MONTHLY");
      setCustomRepeatEvery("1");
      setCustomRepeatUnit("MONTH");
      setExpiryDate("");
      setAutoRenew(false);
      setOpen(false);
      onCreated(data.server?.token ?? data.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : isEdit ? "Failed to update server" : "Failed to create server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!isEdit && (
        <button
          data-tour="add-server"
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
      )}

      {open && (
        <form onSubmit={handleSubmit} className="card p-4 sm:p-5 flex flex-col gap-4 col-span-full">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              {isEdit ? `Edit ${initial?.name ?? "Server"}` : "New Server"}
            </span>
          </div>

          <div className="space-y-3" data-form-section>
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

          <div className="space-y-3" data-form-section>
            <span className={sectionClass}>Access</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
              <label className="xl:col-span-4">
                <span className={labelClass}>Password</span>
                <input
                  type="password"
                  placeholder={isEdit ? "Leave blank to keep current" : "SSH password, if using password login"}
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
                {existingTags.filter((t) => !tags.includes(t)).length > 0 && (
                  <span className="mt-1.5 block">
                    <span className="block text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mb-1">
                      Existing — tap to add
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {existingTags
                        .filter((t) => !tags.includes(t))
                        .map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() =>
                              setTagsInput((prev) => {
                                const cur = parseTagsInput(prev);
                                return cur.includes(tag) ? prev : [...cur, tag].join(", ");
                              })
                            }
                            className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-active)] transition-colors"
                          >
                            + {tag}
                          </button>
                        ))}
                    </span>
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

          <div className="space-y-3" data-form-section>
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

          <div className="space-y-3" data-form-section>
            <span className={sectionClass}>Plan &amp; Duration</span>
            <p className="font-mono text-[10px] text-[var(--text-tertiary)] leading-relaxed">
              Admin-only — never shown to or shared with devs. Saving with a price creates a Service and a pending transaction; the treasury changes only after approval.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
              <label className="xl:col-span-6">
                <span className={labelClass}>Plan link</span>
                <input
                  type="url"
                  placeholder="https://… control panel / order page"
                  value={planLink}
                  onChange={(e) => setPlanLink(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="xl:col-span-6">
                <span className={labelClass}>Duration</span>
                <select
                  value={durationMode}
                  onChange={(e) =>
                    setDurationMode(e.target.value as "NONE" | "LIFETIME" | "ONE_TIME" | "SUBSCRIPTION")
                  }
                  className={inputClass}
                >
                  <option value="NONE">No billing</option>
                  <option value="LIFETIME">Lifetime (never expires)</option>
                  <option value="ONE_TIME">One-time (optional expiry)</option>
                  <option value="SUBSCRIPTION">Subscription (recurring)</option>
                </select>
              </label>
            </div>
            {durationMode !== "NONE" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
                <label className="xl:col-span-3">
                  <span className={labelClass}>{durationMode === "SUBSCRIPTION" ? "Rate" : "Price"}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="xl:col-span-3">
                  <span className={labelClass}>Currency</span>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}
                    className={inputClass}
                  >
                    <option value="INR">INR ₹</option>
                    <option value="USD">USD $</option>
                  </select>
                </label>
                {durationMode === "SUBSCRIPTION" && (
                  <>
                    <label className="xl:col-span-3">
                      <span className={labelClass}>Billing cycle</span>
                      <select
                        value={frequency}
                        onChange={(e) => setFrequency(e.target.value as ServiceFrequency)}
                        className={inputClass}
                      >
                        {SERVICE_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="xl:col-span-3">
                      <span className={labelClass}>Expiry</span>
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    {frequency === "CUSTOM" && (
                      <>
                        <label className="xl:col-span-3">
                          <span className={labelClass}>Repeat every</span>
                          <input
                            required
                            type="number"
                            min="1"
                            step="1"
                            value={customRepeatEvery}
                            onChange={(e) => setCustomRepeatEvery(e.target.value)}
                            className={inputClass}
                          />
                        </label>
                        <label className="xl:col-span-3">
                          <span className={labelClass}>Custom unit</span>
                          <select
                            value={customRepeatUnit}
                            onChange={(e) => setCustomRepeatUnit(e.target.value as CustomRepeatUnit)}
                            className={inputClass}
                          >
                            {CUSTOM_REPEAT_UNITS.map((unit) => <option key={unit} value={unit}>{unit.charAt(0)}{unit.slice(1).toLowerCase()}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    <label className="xl:col-span-12 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={autoRenew}
                        onChange={(e) => setAutoRenew(e.target.checked)}
                        className="h-4 w-4 accent-[var(--mint)]"
                      />
                      <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                        Auto-renew — request admin approval each cycle; deduct only after approval
                      </span>
                    </label>
                  </>
                )}
                {durationMode === "ONE_TIME" && (
                  <label className="xl:col-span-6">
                    <span className={labelClass}>Expiry (optional)</span>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className={inputClass}
                    />
                    <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
                      One-time approval request; never auto-renews. Set an expiry only to track when it lapses.
                    </span>
                  </label>
                )}
              </div>
            )}
            {durationMode !== "NONE" && priceNum > 0 && !initSub && (
              <p className="font-mono text-[10px] text-[var(--amber)]">
                Saving requests approval for {formatMoney(priceNum, currency)}. No funds are deducted until an admin approves it.
              </p>
            )}
            {isEdit && initSub && (
              <p className="font-mono text-[10px] text-[var(--text-tertiary)]">
                Editing plan details won&apos;t create another charge — use “Request renewal” on the card or auto-renew for another approval request.
              </p>
            )}
          </div>

          <div className="space-y-3" data-form-section>
            <span className={sectionClass}>Ownership &amp; responsibility</span>
            <p className="font-mono text-[10px] text-[var(--text-tertiary)] leading-relaxed">Link the machine to its community projects and the developers responsible for incidents and deployments.</p>
            <div>
              <span className={labelClass}>Projects</span>
              <div className="flex flex-wrap gap-2">
                {projects.map((project) => <button key={project.id} type="button" onClick={() => setProjectIds((current) => current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id])} className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border" style={projectIds.includes(project.id) ? { color: "var(--bg-deep)", background: "var(--lime)", borderColor: "var(--lime)" } : { color: "var(--text-secondary)", borderColor: "var(--border)" }}>{project.name}</button>)}
              </div>
            </div>
            <div>
              <span className={labelClass}>Responsible maintainers</span>
              <div className="flex flex-wrap gap-2">
                {devs.map((dev) => <button key={dev.id} type="button" onClick={() => setMaintainerIds((current) => current.includes(dev.id) ? current.filter((id) => id !== dev.id) : [...current, dev.id])} className="rounded-full border px-2 py-1.5" style={maintainerIds.includes(dev.id) ? { color: "var(--bg-deep)", background: "var(--violet)", borderColor: "var(--violet)" } : { color: "var(--text-secondary)", borderColor: "var(--border)" }}><TgUser name={dev.name} photoUrl={dev.photoUrl} size={20} nameClassName="!text-[10px] !font-mono !uppercase !tracking-[0.08em] !text-current" /></button>)}
              </div>
            </div>
            <label className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-bg-deep p-3.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">Alert monitoring</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                  Detect offline, CPU, memory, disk, load and process incidents. Off by default; assigned maintainers choose their own alert categories and channels.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={alertsEnabled}
                onClick={() => setAlertsEnabled((enabled) => !enabled)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${alertsEnabled ? "border-mint/50 bg-mint/30" : "border-[var(--border)] bg-[var(--bg-elevated)]"}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform ${alertsEnabled ? "translate-x-5 bg-mint" : "translate-x-0 bg-text-tertiary"}`} />
              </button>
            </label>
          </div>

          {!isEdit && (
          <div className="space-y-3" data-form-section>
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
                    <TgUser name={dev.name} photoUrl={dev.photoUrl} size={20} nameClassName="!text-[10px] !font-mono !uppercase !tracking-[0.08em] !text-current" />
                  </button>
                );
              })}
              {devs.length === 0 && (
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">No developers found</span>
              )}
            </div>
          </div>
          )}

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
              {submitting
                ? sshKeyFile
                  ? "Uploading..."
                  : isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                ? "Save changes"
                : "Create Server"}
            </button>
            <button
              type="button"
              onClick={() => (isEdit ? onClose?.() : setOpen(false))}
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
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const command = installCommand(token);

  function copy(text: string, mark: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      mark(true);
      setTimeout(() => mark(false), 2000);
    });
  }

  return (
    <div
      className="card p-4 sm:p-6 flex flex-col gap-2"
      style={{ border: "1px solid rgba(var(--lime-rgb, 52,211,153), 0.3)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Install command for {name} (copy now — token shown once)
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
      <p className="font-mono text-[10px] text-[var(--text-tertiary)] leading-relaxed">
        Run this on the target VPS (as root). The agent installs and starts reporting within ~30s.
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <code className="flex-1 font-mono text-xs text-[var(--lime)] bg-[var(--bg-deep)] px-3 py-2 rounded-lg break-all select-all">
          {command}
        </code>
        <button
          onClick={() => copy(command, setCopiedCmd)}
          className="font-mono text-[10px] uppercase px-3 py-2 rounded-lg shrink-0 transition-colors"
          style={{
            color: copiedCmd ? "var(--mint)" : "var(--bg-deep)",
            background: copiedCmd ? "var(--bg-deep)" : "var(--lime)",
          }}
        >
          {copiedCmd ? "Copied" : "Copy command"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] shrink-0">
          Token
        </span>
        <code className="flex-1 min-w-0 font-mono text-[11px] text-[var(--text-secondary)] break-all select-all">
          {token}
        </code>
        <button
          onClick={() => copy(token, setCopiedToken)}
          className="font-mono text-[10px] uppercase px-2 py-1 rounded shrink-0 transition-colors"
          style={{
            color: copiedToken ? "var(--mint)" : "var(--text-secondary)",
            background: "var(--bg-deep)",
          }}
        >
          {copiedToken ? "Copied" : "Copy"}
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
  const [editingServer, setEditingServer] = useState<Server | null>(null);

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    id: string;
    name: string;
    action: "delete" | "reject" | "refund";
    loading: boolean;
    detail?: string;
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

  /* Initial fetch on mount (skeleton shows until this resolves) */
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchServers(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchServers]);

  /* Background refresh: on focus/visibility + every 20s while visible (agent heartbeats) */
  useAutoRefresh(fetchServers, 20000);

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
      if (data.server?.token) {
        setTokenDisplay({ name: server?.name || data.server.name || "Server", token: data.server.token });
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
    } else if (confirmState.action === "refund") {
      await handleRefund(confirmState.id);
    } else {
      await handleReject(confirmState.id);
    }
    setConfirmState({ open: false, id: "", name: "", action: "delete", loading: false });
  }

  function handleCreated(token?: string) {
    if (token) setTokenDisplay({ name: "New Server", token });
    fetchServers();
  }

  async function handleRenew(id: string) {
    try {
      const res = await fetch("/api/vps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "renew" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Renew failed");
      }
    } finally {
      await fetchServers();
    }
  }

  async function handleRefund(id: string) {
    try {
      const res = await fetch("/api/vps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "refund" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Refund failed");
      }
    } finally {
      await fetchServers();
    }
  }

  function requestEdit(server: Server) {
    setEditingServer(server);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function requestRefund(server: Server) {
    const sub = server.subscription;
    const detail = sub ? `${formatMoney(sub.price, sub.currency)} will be credited back to the balance and the plan cancelled.` : "";
    setConfirmState({ open: true, id: server.id, name: server.name, action: "refund", loading: false, detail });
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
  const existingTags = Array.from(new Set(servers.flatMap((s) => s.tags ?? []))).sort();
  const onlineCount = approvedServers.filter((s) => s.status === "online").length;
  const offlineCount = approvedServers.filter((s) => s.status === "offline").length;

  return (
    <div className="pb-20 md:pb-0">
      <ServicesNav role="ADMIN" />
      <ConfirmDialog
        open={confirmState.open}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
        onConfirm={handleConfirm}
        title={
          confirmState.action === "delete"
            ? `Delete "${confirmState.name}"?`
            : confirmState.action === "refund"
            ? `Refund "${confirmState.name}"?`
            : `Reject "${confirmState.name}"?`
        }
        message={
          confirmState.action === "delete"
            ? "This cannot be undone. Linked vault credentials and developer access are removed, and any active plan charge is refunded to the balance."
            : confirmState.action === "refund"
            ? confirmState.detail || "Credit the rate back to the balance and cancel this plan."
            : "This cannot be undone"
        }
        confirmLabel={
          confirmState.action === "delete" ? "Delete" : confirmState.action === "refund" ? "Refund" : "Reject"
        }
        variant={confirmState.action === "refund" ? "default" : "danger"}
        loading={confirmState.loading}
      />
      <PageTour pageKey="admin-vps" version={2} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 data-tour="admin-vps-title" className="text-3xl font-extrabold">
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
        <ServerForm mode="add" onCreated={handleCreated} existingTags={existingTags} />
      </div>

      {/* Edit Server form (full-width, shown when editing) */}
      {editingServer && (
        <div className="mb-6">
          <ServerForm
            key={editingServer.id}
            mode="edit"
            initial={editingServer}
            onCreated={handleCreated}
            onClose={() => setEditingServer(null)}
            existingTags={existingTags}
          />
        </div>
      )}

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
                onEditRequest={requestEdit}
                onRenew={handleRenew}
                onRefundRequest={requestRefund}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
