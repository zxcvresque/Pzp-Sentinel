"use client";

import { useEffect, useState } from "react";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  description: string;
  status: string;
  date: string;
}

export default function DonorDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetch("/api/transactions?limit=50")
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions || []))
      .finally(() => setLoading(false));
  }, []);

  const totalContributed = transactions
    .filter((t) => t.status === "APPROVED")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        method,
        direction: "IN",
        type: "DONATION",
        description: description || `Donation via ${method}`,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setTransactions((prev) => [data.transaction, ...prev]);
      setShowForm(false);
      setAmount("");
      setDescription("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-20 w-full mb-4" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold">
            Your <span className="font-display text-lime">Donations</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Total contributed:{" "}
            <span className="text-mint font-semibold">
              ₹{totalContributed.toLocaleString("en-IN")}
            </span>
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "Submit Payment"}
        </button>
      </div>

      {success && (
        <div className="mb-4 p-4 rounded-lg bg-mint/8 border border-mint/20 text-mint text-sm">
          Payment submitted! Your donation is pending admin approval.
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
          </div>
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note"
              className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !amount}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Submitting..." : "Submit Donation"}
          </button>
        </form>
      )}

      {transactions.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No donations yet.</p>
          <p className="text-text-tertiary text-sm">
            Submit your first donation to support the community.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="card p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-medium">{tx.description}</div>
                <div className="text-text-tertiary text-xs mt-1">
                  {new Date(tx.date).toLocaleDateString()} · {tx.method}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-mint font-semibold">
                  ₹{parseFloat(tx.amount).toLocaleString()}
                </span>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
