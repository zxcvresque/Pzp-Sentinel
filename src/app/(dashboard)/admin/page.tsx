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
}

export default function AdminDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/transactions?limit=10").then((r) => r.json()),
      fetch("/api/transactions/stats").then((r) => r.json()),
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Balance
          </div>
          <div className="text-3xl font-extrabold text-mint">
            ₹{(stats?.totalBalance ?? 0).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Donated
          </div>
          <div className="text-3xl font-extrabold">
            ₹{(stats?.totalDonated ?? 0).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Total Spent
          </div>
          <div className="text-3xl font-extrabold text-coral">
            ₹{(stats?.totalSpent ?? 0).toLocaleString("en-IN")}
          </div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Pending
          </div>
          <div className="text-3xl font-extrabold text-amber">
            {stats?.pendingCount ?? 0}
          </div>
        </div>
      </div>

      {/* Burn Rate + Runway */}
      {stats && (() => {
        const breakdown = stats.monthlyBreakdown ?? [];
        const last3 = breakdown.slice(-3);
        const burnRate =
          last3.length > 0
            ? last3.reduce((s, m) => s + m.spent, 0) / last3.length
            : 0;
        const runway =
          burnRate > 0 ? Math.floor(stats.totalBalance / burnRate) : null;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="card p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
                Monthly Burn
              </div>
              <div className="text-3xl font-extrabold text-coral">
                ₹{Math.round(burnRate).toLocaleString("en-IN")}
              </div>
              <div className="text-text-tertiary text-xs mt-1">avg last 3 months</div>
            </div>
            <div className="card p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
                Runway
              </div>
              <div className="text-3xl font-extrabold text-cyan">
                {runway !== null
                  ? `${runway} month${runway !== 1 ? "s" : ""}`
                  : "∞"}
              </div>
              <div className="text-text-tertiary text-xs mt-1">at current burn rate</div>
            </div>
          </div>
        );
      })()}

      {/* Monthly Trend Chart */}
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
            <div className="card p-5">
              <div className="flex items-end gap-3 justify-between" style={{ height: 160 }}>
                {data.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                    <div className="flex-1 w-full flex items-end justify-center gap-1">
                      <div
                        className="w-2/5 rounded-t transition-all"
                        style={{
                          height: `${Math.max((m.donated / maxVal) * 100, 2)}%`,
                          backgroundColor: "var(--mint)",
                          opacity: m.donated > 0 ? 1 : 0.2,
                        }}
                        title={`Donated: ₹${m.donated.toLocaleString("en-IN")}`}
                      />
                      <div
                        className="w-2/5 rounded-t transition-all"
                        style={{
                          height: `${Math.max((m.spent / maxVal) * 100, 2)}%`,
                          backgroundColor: "var(--coral)",
                          opacity: m.spent > 0 ? 1 : 0.2,
                        }}
                        title={`Spent: ₹${m.spent.toLocaleString("en-IN")}`}
                      />
                    </div>
                    <div className="font-mono text-[9px] text-text-tertiary mt-1 whitespace-nowrap">
                      {m.month}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[var(--border)]">
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
