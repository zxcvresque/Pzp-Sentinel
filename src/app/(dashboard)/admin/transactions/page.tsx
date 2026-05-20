"use client";

import { useEffect, useState } from "react";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  direction: string;
  type: string;
  description: string;
  status: string;
  date: string;
  fromUser?: { name: string } | null;
  createdBy?: { name: string } | null;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [directionFilter, setDirectionFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [direction, setDirection] = useState("OUT");
  const [type, setType] = useState("EXPENSE");
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetch("/api/transactions?limit=100")
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions || []))
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, method, direction, type, description }),
    });
    if (res.ok) {
      const data = await res.json();
      setTransactions((prev) => [data.transaction, ...prev]);
      setShowForm(false);
      setAmount("");
      setDescription("");
    }
    setSubmitting(false);
  }

  const filtered = transactions.filter((t) => {
    if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
    if (directionFilter !== "ALL" && t.direction !== directionFilter) return false;
    return true;
  });

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-12 w-full mb-2" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          All <span className="font-display text-lime">Transactions</span>
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "Log Transaction"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Amount (INR)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Direction
              </label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                <option value="OUT">Expense (OUT)</option>
                <option value="IN">Income (IN)</option>
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                <option value="EXPENSE">Expense</option>
                <option value="SUBSCRIPTION">Subscription</option>
                <option value="DONATION">Donation</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Method
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                <option value="UPI">UPI</option>
                <option value="BMC">Buy Me a Coffee</option>
                <option value="BANK">Bank Transfer</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this for?"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !amount || !description}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Logging..." : "Log Transaction"}
          </button>
        </form>
      )}

      <div className="flex gap-2 mb-4">
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors ${
              statusFilter === s
                ? "bg-lime text-bg-void border-lime"
                : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="mx-1 border-r border-[var(--border)]" />
        {["ALL", "IN", "OUT"].map((d) => (
          <button
            key={d}
            onClick={() => setDirectionFilter(d)}
            className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors ${
              directionFilter === d
                ? "bg-violet text-bg-void border-violet"
                : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary">No transactions match your filters.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Description</th>
                  <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Amount</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Type</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Method</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Status</th>
                  <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Date</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => (
                  <tr key={tx.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <td className="p-4 text-sm">
                      <div>{tx.description}</div>
                      {tx.fromUser && (
                        <div className="text-text-tertiary text-xs mt-0.5">by {tx.fromUser.name}</div>
                      )}
                    </td>
                    <td className={`p-4 text-sm text-right font-medium ${tx.direction === "IN" ? "text-mint" : "text-coral"}`}>
                      {tx.direction === "IN" ? "+" : "-"}
                      {tx.currency === "INR" ? "₹" : "$"}
                      {parseFloat(tx.amount).toLocaleString()}
                    </td>
                    <td className="p-4 text-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] text-text-secondary">
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--violet-dim)] text-violet">
                        {tx.method}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`status-tag ${
                        tx.status === "APPROVED" ? "status-approved" : tx.status === "PENDING" ? "status-pending" : "status-rejected"
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {tx.status}
                      </span>
                    </td>
                    <td className="p-4 text-right text-text-secondary text-sm">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-center">
                      {tx.status === "PENDING" && (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => handleApprove(tx.id)}
                            className="px-3 py-1 rounded-full text-xs font-semibold bg-mint/10 text-mint hover:bg-mint/20 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(tx.id)}
                            className="px-3 py-1 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
