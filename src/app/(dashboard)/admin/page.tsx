"use client";

import { useEffect, useState } from "react";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  direction: string;
  description: string;
  status: string;
  date: string;
  fromUser?: { name: string } | null;
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
}

export default function AdminDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/transactions?limit=10").then((r) => {
        if (!r.ok) throw new Error(`Transactions: ${r.status}`);
        return r.json();
      }),
      fetch("/api/transactions/stats").then((r) => {
        if (!r.ok) throw new Error(`Stats: ${r.status}`);
        return r.json();
      }),
    ])
      .then(([txData, statsData]) => {
        setTransactions(txData.transactions || []);
        setStats(statsData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold">
          Treasury <span className="font-display text-lime">Overview</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {/* Balance */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Balance
          </div>
          <div className="text-3xl font-extrabold text-mint">
            ₹{(stats?.totalBalance ?? 0).toLocaleString("en-IN")}
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
            ₹{(stats?.totalDonated ?? 0).toLocaleString("en-IN")}
          </div>
        </div>

        {/* Spent */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Spent
          </div>
          <div className="text-3xl font-extrabold text-coral">
            ₹{(stats?.totalSpent ?? 0).toLocaleString("en-IN")}
          </div>
        </div>

        {/* Burn Rate + Runway (combined card) */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Burn Rate / Runway
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-extrabold text-coral">
              ₹{Math.round(stats?.burnRate ?? 0).toLocaleString("en-IN")}
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
                : "Infinite"}
            </span>
            <span className="text-text-tertiary text-[10px] font-mono">runway</span>
          </div>
          <div className="text-text-tertiary text-[10px] mt-1.5 font-mono">
            avg over last 6 months
          </div>
        </div>

        {/* Subscriptions */}
        <div className="stat-card card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Subscriptions
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
              ₹{Math.round(stats?.monthlySubs ?? 0).toLocaleString("en-IN")}
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
                          ₹{(m.donated - m.spent).toLocaleString("en-IN")}
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
                      ₹{m.donated.toLocaleString("en-IN")}
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
                      ₹{m.spent.toLocaleString("en-IN")}
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
                        ₹{amount.toLocaleString("en-IN")} ({pct.toFixed(1)}%)
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

      <div>
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
                      Method
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
                      <td className="p-4 text-sm">{tx.description}</td>
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
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--violet-dim)] text-violet">
                          {tx.method}
                        </span>
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
    </div>
  );
}
