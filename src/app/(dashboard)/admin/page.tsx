"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageTour from "@/components/PageTour";
import TransactionAttribution from "@/components/TransactionAttribution";
import CurrencyToggle from "@/components/CurrencyToggle";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  convertCurrencyAmount,
  formatCurrencyAmount,
  type DisplayCurrency,
} from "@/lib/currency-display";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paymentMethodDetail?: string | null;
  direction: string;
  description: string;
  status: string;
  date: string;
  fromUser?: { name: string; photoUrl?: string | null; telegramUser?: string | null } | null;
  createdBy?: { name: string; photoUrl?: string | null; telegramUser?: string | null } | null;
}

interface MonthlyData {
  month: string;
  donated: number;
  spent: number;
}

interface Stats {
  totalBalance: number;
  totalDonated: number;
  totalSpent: number;
  pendingCount: number;
  monthlyBreakdown: MonthlyData[];
  expenseByType: Record<string, number>;
  burnRate: number;
  runwayMonths: number | null;
  activeSubs: number;
  monthlySubs: number;
  displayCurrency?: string;
  exchangeRate?: number | null;
}

interface BmcStats {
  webhookConfigured: boolean;
  webhookVerified: boolean;
  lastWebhookAt: string | null;
  lastWebhookStatus: string | null;
  legacySyncAvailable: boolean;
  checkoutUrl: string | null;
  totalSupporters: number;
  totalEarned: number;
  totalsByCurrency: Record<string, number>;
  totalTransactions: number;
  unmatchedTransactions: number;
  eventBreakdown: Record<string, number>;
  recentEvents: {
    id: string;
    eventType: string;
    liveMode: boolean;
    supporterName: string | null;
    amount: string | null;
    currency: string | null;
    status: string;
    attributionStatus: string;
    createdAt: string;
  }[];
  recent: {
    id: string;
    amount: string;
    currency: string;
    description: string;
    date: string;
  }[];
}

export default function AdminDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const currencyRef = useRef(currency);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [bmcStats, setBmcStats] = useState<BmcStats | null>(null);
  const [bmcCurrency, setBmcCurrency] = useState<DisplayCurrency>("USD");
  const [bmcSyncing, setBmcSyncing] = useState(false);
  const [bmcResult, setBmcResult] = useState<string | null>(null);

  useEffect(() => {
    currencyRef.current = currency;
  }, [currency]);

  // Fetch dashboard data — stable callback used for the initial mount load AND
  // every background refresh. It never toggles loading/skeleton state and never
  // clears existing data, so background refreshes update silently with no
  // flicker; a failed refresh keeps the last good data. Reads the latest
  // currency via currencyRef so the callback can stay stable.
  const load = useCallback(async () => {
    const curr = currencyRef.current;
    const [txData, statsData, bmcData] = await Promise.all([
      fetch("/api/transactions?limit=10").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/transactions/stats" + (curr !== "INR" ? `?currency=${curr}` : "")).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/bmc").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (txData) setTransactions(txData.transactions || []);
    if (statsData) {
      setStats(statsData);
      if (statsData.exchangeRate) setExchangeRate(statsData.exchangeRate);
    }
    if (bmcData) setBmcStats(bmcData);
  }, []);

  useEffect(() => {
    // Initial mount load: show the skeleton until the first fetch resolves.
    // Swallow errors (same as before) and drop the skeleton once settled.
    load().catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background refresh on focus / visibility regain + every 30s while visible.
  useAutoRefresh(load, 30000);

  async function toggleCurrency() {
    const next = currency === "INR" ? "USD" : "INR";
    setCurrencyLoading(true);
    try {
      const res = await fetch(`/api/transactions/stats?currency=${next}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
      setCurrency(next);
      if (data.exchangeRate) setExchangeRate(data.exchangeRate);
    } catch {
      // stay on current currency
    } finally {
      setCurrencyLoading(false);
    }
  }

  const sym = currency === "INR" ? "₹" : "$";
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const bmcCurrencyEntries = Object.entries(bmcStats?.totalsByCurrency || {});
  const bmcNeedsRate = bmcCurrencyEntries.some(([sourceCurrency]) => sourceCurrency !== bmcCurrency);
  const bmcTotal = bmcNeedsRate && !exchangeRate
    ? null
    : bmcCurrencyEntries.reduce(
        (sum, [sourceCurrency, amount]) => sum + convertCurrencyAmount(amount, sourceCurrency, bmcCurrency, exchangeRate),
        0,
      );

  function chooseBmcCurrency(next: DisplayCurrency) {
    setBmcCurrency(next);
  }

  async function handleApprove(id: string) {
    await fetch(`/api/transactions/${id}/approve`, { method: "POST" });
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "APPROVED" } : t))
    );
  }

  async function handleReject(id: string) {
    const reason = prompt("Rejection reason (optional):");
    await fetch(`/api/transactions/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "REJECTED" } : t))
    );
  }

  async function handleBmcSync() {
    setBmcSyncing(true);
    setBmcResult(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch("/api/bmc/sync", { method: "POST", signal: controller.signal });
      const data = await res.json();
      if (!res.ok) {
        setBmcResult(`Error: ${data.error || "Sync failed"}`);
        return;
      }
      setBmcResult(
        `Synced ${data.synced} new (${data.monthlySynced || 0} monthly), skipped ${data.skipped} existing` +
        (data.errors?.length ? ` (${data.errors.length} errors)` : ""),
      );
      // Refresh dashboard data
      load();
    } catch (error) {
      setBmcResult(error instanceof DOMException && error.name === "AbortError"
        ? "Error: BMC sync timed out after 90 seconds"
        : "Error: Network error during sync");
    } finally {
      window.clearTimeout(timeout);
      setBmcSyncing(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold">
            Treasury <span className="font-display text-lime">Overview</span>
          </h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-3 w-20 mb-3" />
              <div className="skeleton h-8 w-28" />
            </div>
          ))}
        </div>
        <div className="card p-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-10 w-full mb-2" />
          ))}
        </div>
      </div>
    );
  }

  const pending = transactions.filter((t) => t.status === "PENDING");

  return (
    <div>
      <div className="flex items-start justify-between mb-8 gap-2">
        <h1 className="text-3xl font-extrabold">
          Treasury <span className="font-display text-lime">Overview</span>
        </h1>
        <div data-tour="currency-toggle" className="flex flex-col items-end gap-0.5 shrink-0 sm:flex-row sm:items-center sm:gap-3">
          {exchangeRate && (
            <span className="font-mono text-[10px] text-text-tertiary transition-opacity duration-200 sm:order-first" style={{ opacity: currency === "USD" ? 1 : 0 }}>
              1 USD = ₹{exchangeRate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          )}
          <div
            className="relative flex items-center rounded-full border border-[var(--border)] overflow-hidden transition-opacity duration-150"
            style={{ opacity: currencyLoading ? 0.5 : 1 }}
          >
            {/* Sliding highlight pill */}
            <div
              className="absolute top-0 bottom-0 w-1/2 rounded-full transition-transform duration-200 ease-out"
              style={{
                background: "var(--lime)",
                transform: currency === "USD" ? "translateX(100%)" : "translateX(0)",
              }}
            />
            <button
              onClick={() => currency !== "INR" && toggleCurrency()}
              disabled={currencyLoading}
              className="relative z-10 font-mono text-[10px] uppercase tracking-[0.08em] px-3.5 py-1.5 flex items-center gap-1 transition-colors duration-200"
              style={{
                color: currency === "INR" ? "var(--bg-void)" : "var(--text-tertiary)",
                fontWeight: currency === "INR" ? 700 : 400,
              }}
            >
              <span style={{ fontSize: 11 }}>₹</span> INR
            </button>
            <button
              onClick={() => currency !== "USD" && toggleCurrency()}
              disabled={currencyLoading}
              className="relative z-10 font-mono text-[10px] uppercase tracking-[0.08em] px-3.5 py-1.5 flex items-center gap-1 transition-colors duration-200"
              style={{
                color: currency === "USD" ? "var(--bg-void)" : "var(--text-tertiary)",
                fontWeight: currency === "USD" ? 700 : 400,
              }}
            >
              <span style={{ fontSize: 11 }}>$</span> USD
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {/* Balance */}
        <div data-tour="stat-cards" className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Balance
          </div>
          <div className="text-3xl font-extrabold text-mint">
            {sym}{(stats?.totalBalance ?? 0).toLocaleString(locale)}
          </div>
          {stats && stats.totalDonated > 0 && (
            <div
              className="mt-3 h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min((stats.totalBalance / stats.totalDonated) * 100, 100)}%`,
                  backgroundColor: "var(--mint)",
                  opacity: 0.7,
                }}
              />
            </div>
          )}
          <div className="text-text-tertiary text-[10px] mt-1.5 font-mono">
            {stats && stats.totalDonated > 0
              ? `${((stats.totalBalance / stats.totalDonated) * 100).toFixed(0)}% of donated funds remaining`
              : "no donations yet"}
          </div>
        </div>

        {/* Donated */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Donated
          </div>
          <div className="text-3xl font-extrabold">
            {sym}{(stats?.totalDonated ?? 0).toLocaleString(locale)}
          </div>
        </div>

        {/* Spent */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Spent
          </div>
          <div className="text-3xl font-extrabold text-coral">
            {sym}{(stats?.totalSpent ?? 0).toLocaleString(locale)}
          </div>
        </div>

        {/* Burn Rate + Runway (combined card) */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Burn Rate / Runway
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-extrabold text-coral">
              {sym}{Math.round(stats?.burnRate ?? 0).toLocaleString(locale)}
            </div>
            <span className="text-text-tertiary text-xs">/mo</span>
          </div>
          <div
            className="mt-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md"
            style={{ backgroundColor: "rgba(99,102,241,0.08)" }}
          >
            <span
              className="font-mono text-xs font-semibold"
              style={{ color: "var(--lime)" }}
            >
              {stats?.runwayMonths !== null && stats?.runwayMonths !== undefined
                ? `${stats.runwayMonths} month${stats.runwayMonths !== 1 ? "s" : ""}`
                : "—"}
            </span>
            <span className="text-text-tertiary text-[10px] font-mono">runway</span>
          </div>
          <div className="text-text-tertiary text-[10px] mt-1.5 font-mono">
            avg over last 6 months
          </div>
        </div>

        {/* Recurring costs */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Recurring Costs
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-extrabold" style={{ color: "var(--violet)" }}>
              {stats?.activeSubs ?? 0}
            </div>
            <span className="text-text-tertiary text-xs">active</span>
          </div>
          <div
            className="mt-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md"
            style={{ backgroundColor: "rgba(167,139,250,0.08)" }}
          >
            <span className="font-mono text-xs font-semibold" style={{ color: "var(--violet)" }}>
              {sym}{Math.round(stats?.monthlySubs ?? 0).toLocaleString(locale)}
            </span>
            <span className="text-text-tertiary text-[10px] font-mono">/month</span>
          </div>
        </div>

        {/* Pending */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Pending Approvals
          </div>
          <div className="text-3xl font-extrabold text-amber">
            {stats?.pendingCount ?? 0}
          </div>
          {(stats?.pendingCount ?? 0) > 0 && (
            <div
              className="mt-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md"
              style={{ backgroundColor: "rgba(251,191,36,0.08)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: "var(--amber)", animation: "pulse 2s infinite" }}
              />
              <span className="text-amber text-[10px] font-mono">needs review</span>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Trend — Horizontal Bar Chart */}
      {stats?.monthlyBreakdown && stats.monthlyBreakdown.length > 0 && (() => {
        const data = stats.monthlyBreakdown;
        const maxVal = Math.max(
          ...data.map((m) => Math.max(m.donated, m.spent)),
          1,
        );

        return (
          <div className="mb-8">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
              Monthly Trend
            </h2>
            <div className="card p-5 space-y-4">
              {data.map((m) => (
                <div key={m.month}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[11px] text-text-secondary font-medium w-16 shrink-0">
                      {m.month}
                    </span>
                    <div className="flex items-center gap-3 font-mono text-[10px]">
                      <span className="text-text-tertiary">
                        Net:{" "}
                        <span
                          className="font-semibold"
                          style={{ color: m.donated - m.spent >= 0 ? "var(--mint)" : "var(--coral)" }}
                        >
                          {m.donated - m.spent >= 0 ? "+" : ""}
                          {sym}{(m.donated - m.spent).toLocaleString(locale)}
                        </span>
                      </span>
                    </div>
                  </div>
                  {/* Donated bar */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="font-mono text-[9px] w-10 text-right shrink-0"
                      style={{ color: "var(--mint)", opacity: 0.7 }}
                    >
                      IN
                    </span>
                    <div
                      className="flex-1 h-3 rounded-full overflow-hidden"
                      style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max((m.donated / maxVal) * 100, 0.5)}%`,
                          backgroundColor: "var(--mint)",
                          opacity: m.donated > 0 ? 0.85 : 0.15,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-text-tertiary w-20 text-right shrink-0">
                      {sym}{m.donated.toLocaleString(locale)}
                    </span>
                  </div>
                  {/* Spent bar */}
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[9px] w-10 text-right shrink-0"
                      style={{ color: "var(--coral)", opacity: 0.7 }}
                    >
                      OUT
                    </span>
                    <div
                      className="flex-1 h-3 rounded-full overflow-hidden"
                      style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max((m.spent / maxVal) * 100, 0.5)}%`,
                          backgroundColor: "var(--coral)",
                          opacity: m.spent > 0 ? 0.85 : 0.15,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-text-tertiary w-20 text-right shrink-0">
                      {sym}{m.spent.toLocaleString(locale)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-3 border-t border-[var(--border)]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "var(--mint)" }} />
                  <span className="font-mono text-[10px] text-text-tertiary">Donated</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "var(--coral)" }} />
                  <span className="font-mono text-[10px] text-text-tertiary">Spent</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cost Breakdown by Type */}
      {stats?.expenseByType && Object.keys(stats.expenseByType).length > 0 && (() => {
        const entries = Object.entries(stats.expenseByType).sort(
          ([, a], [, b]) => b - a,
        );
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const typeColors: Record<string, string> = {
          DONATION: "var(--mint)",
          EXPENSE: "var(--coral)",
          SUBSCRIPTION: "var(--violet)",
          OTHER: "var(--amber)",
        };

        return (
          <div className="mb-8">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
              Cost Breakdown
            </h2>
            <div className="card p-5 space-y-3">
              {entries.map(([type, amount]) => {
                const pct = total > 0 ? (amount / total) * 100 : 0;
                const color = typeColors[type] || "var(--cyan)";
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
                        {type}
                      </span>
                      <span className="font-mono text-[10px] text-text-tertiary">
                        {sym}{amount.toLocaleString(locale)} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {pending.length > 0 && (
        <div className="mb-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
            Pending Approvals
          </h2>
          <div className="space-y-3">
            {pending.map((tx) => (
              <div key={tx.id} className="card p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{tx.description}</div>
                  <div className="text-text-secondary text-xs mt-1">
                    {tx.fromUser?.name || "Unknown"} · {tx.currency} {tx.amount} · {tx.method}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(tx.id)}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold bg-mint/10 text-mint hover:bg-mint/20 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(tx.id)}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buy Me a Coffee */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            Buy Me a Coffee
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
          <CurrencyToggle value={bmcCurrency} onChange={chooseBmcCurrency} exchangeRate={exchangeRate} />
          <span
            title={bmcStats?.lastWebhookAt
              ? `Last delivery: ${new Date(bmcStats.lastWebhookAt).toLocaleString()} · ${bmcStats.lastWebhookStatus}`
              : bmcStats?.webhookConfigured ? "Secret configured, but Sentinel has never received a valid delivery" : "Webhook secret is missing"}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.1em] ${bmcStats?.webhookVerified ? "border-mint/20 bg-mint/8 text-mint" : "border-amber/20 bg-amber/8 text-amber"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${bmcStats?.webhookVerified ? "bg-mint" : "bg-amber"}`} />
            {bmcStats?.webhookVerified ? "Webhook verified" : bmcStats?.webhookConfigured ? "Webhook unverified" : "Not configured"}
          </span>
          {bmcStats?.legacySyncAvailable && <button
            onClick={handleBmcSync}
            disabled={bmcSyncing}
            className="font-mono text-[10px] uppercase tracking-[0.08em] px-4 py-1.5 rounded-full border transition-colors flex items-center gap-2"
            style={{
              borderColor: "var(--amber)",
              background: "rgba(251,191,36,0.08)",
              color: "var(--amber)",
              opacity: bmcSyncing ? 0.5 : 1,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={bmcSyncing ? { animation: "spin 1s linear infinite" } : undefined}
            >
              <path d="M1.5 8a6.5 6.5 0 0112.3-2.9M14.5 8a6.5 6.5 0 01-12.3 2.9" />
              <path d="M14.5 2v3h-3" />
              <path d="M1.5 14v-3h3" />
            </svg>
            {bmcSyncing ? "Syncing..." : "Sync BMC"}
          </button>}
          </div>
        </div>

        {bmcResult && (
          <div
            className="mb-3 p-3 rounded-lg text-sm font-mono text-[11px]"
            style={{
              background: bmcResult.startsWith("Error")
                ? "rgba(248,113,113,0.08)"
                : "rgba(251,191,36,0.08)",
              border: `1px solid ${bmcResult.startsWith("Error") ? "rgba(248,113,113,0.2)" : "rgba(251,191,36,0.2)"}`,
              color: bmcResult.startsWith("Error") ? "var(--coral)" : "var(--amber)",
            }}
          >
            {bmcResult}
          </div>
        )}

        <div className="card p-5">
          <div className="grid grid-cols-2 gap-4 mb-4 sm:grid-cols-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Supporters
              </div>
              <div className="text-2xl font-extrabold" style={{ color: "var(--amber)" }}>
                {bmcStats?.totalSupporters ?? 0}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Total Earned
              </div>
              <div className="text-2xl font-extrabold text-mint">
                {bmcTotal == null ? "Loading rate…" : formatCurrencyAmount(bmcTotal, bmcCurrency)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Transactions
              </div>
              <div className="text-2xl font-extrabold text-text-primary">
                {bmcStats?.totalTransactions ?? 0}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Unmatched
              </div>
              <div className={`text-2xl font-extrabold ${(bmcStats?.unmatchedTransactions ?? 0) > 0 ? "text-coral" : "text-mint"}`}>
                {bmcStats?.unmatchedTransactions ?? 0}
              </div>
            </div>
          </div>

          {bmcStats?.eventBreakdown && Object.keys(bmcStats.eventBreakdown).length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
              {Object.entries(bmcStats.eventBreakdown).map(([event, count]) => (
                <span key={event} className="rounded-full border border-[var(--border)] bg-white/[.02] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.08em] text-text-secondary">
                  {event.replaceAll("_", " ")} · {count}
                </span>
              ))}
            </div>
          )}

          {bmcStats?.recent && bmcStats.recent.length > 0 && (
            <>
              <div className="border-t border-[var(--border)] pt-3 mt-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                  Recent BMC Donations
                </div>
                <div className="space-y-2">
                  {bmcStats.recent.slice(0, 5).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary truncate">
                          {tx.description}
                        </div>
                        <div className="text-text-tertiary text-[10px] font-mono mt-0.5">
                          {new Date(tx.date).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-mint font-semibold text-sm ml-3 shrink-0">
                        +{formatCurrencyAmount(
                          convertCurrencyAmount(Number(tx.amount), tx.currency, bmcCurrency, exchangeRate),
                          bmcCurrency,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {bmcStats?.recentEvents && bmcStats.recentEvents.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Webhook activity</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {bmcStats.recentEvents.slice(0, 6).map((event) => (
                  <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/[.015] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-text-primary">{event.eventType.replaceAll("_", " ")}</div>
                      <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[.07em] text-text-tertiary">
                        {event.supporterName || "Anonymous"} · {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!event.liveMode && <span className="rounded-full bg-violet/10 px-2 py-1 font-mono text-[8px] uppercase text-violet">Test</span>}
                      {event.attributionStatus === "UNMATCHED" && <span className="rounded-full bg-coral/10 px-2 py-1 font-mono text-[8px] uppercase text-coral">Needs donor</span>}
                      <span className="rounded-full bg-mint/8 px-2 py-1 font-mono text-[8px] uppercase text-mint">{event.status.replaceAll("_", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!bmcStats || bmcStats.totalTransactions === 0) && (
            <div className="text-center py-4">
              <p className="text-text-tertiary text-sm">
                No live BMC payments received yet. Send a dashboard test event to verify the webhook, then real payments will appear here automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      <div data-tour="recent-transactions">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
          Recent Transactions
        </h2>
        {transactions.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-text-secondary mb-2">No transactions yet.</p>
            <p className="text-text-tertiary text-sm">Log your first transaction to get started.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      Description
                    </th>
                    <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      Amount
                    </th>
                    <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      Status
                    </th>
                    <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      <td className="p-4 text-sm">
                        <div>{tx.description}</div>
                        <div className="mt-2">
                          <TransactionAttribution fromUser={tx.fromUser} createdBy={tx.createdBy} method={tx.method} detail={tx.paymentMethodDetail} size={24} />
                        </div>
                      </td>
                      <td
                        className={`p-4 text-sm text-right font-medium ${
                          tx.direction === "IN" ? "text-mint" : "text-coral"
                        }`}
                      >
                        {tx.direction === "IN" ? "+" : "-"}
                        {tx.currency === "INR" ? "₹" : "$"}
                        {parseFloat(tx.amount).toLocaleString()}
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`status-tag ${
                            tx.status === "APPROVED"
                              ? "status-approved"
                              : tx.status === "PENDING"
                                ? "status-pending"
                                : "status-rejected"
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {tx.status}
                        </span>
                      </td>
                      <td className="p-4 text-right text-text-secondary text-sm">
                        {new Date(tx.date).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <PageTour pageKey="admin-dashboard" />
    </div>
  );
}
