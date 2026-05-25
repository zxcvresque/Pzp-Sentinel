"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";

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
  const [formError, setFormError] = useState("");

  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");

  useEffect(() => {
    fetch("/api/transactions?limit=50")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load transactions");
        return r.json();
      })
      .then((data) => setTransactions(data.transactions || []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, []);

  const approved = transactions.filter((t) => t.status === "APPROVED");
  const totalContributed = approved.reduce(
    (sum, t) => sum + parseFloat(t.amount),
    0
  );
  const pendingCount = transactions.filter(
    (t) => t.status === "PENDING"
  ).length;
  const approvedCount = approved.length;

  const filteredTransactions =
    statusFilter === "ALL"
      ? transactions
      : transactions.filter((t) => t.status === statusFilter);

  function currencySymbol(cur: string) {
    return cur === "USD" ? "$" : "₹";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError("");

    try {
      const desc =
        reference.trim() || `Donation via ${method}`;
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency,
          method,
          direction: "IN",
          type: "DONATION",
          description: desc,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Submission failed");
      }

      const data = await res.json();
      setTransactions((prev) => [data.transaction, ...prev]);
      setShowForm(false);
      setAmount("");
      setReference("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setSubmitting(false);
    }
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
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold">
            My <span className="font-display text-lime">Donations</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Your contributions at a glance
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setFormError("");
          }}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "New Donation"}
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="stat-card" style={{ "--accent": "var(--mint)" } as React.CSSProperties}>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
            Total Contributed
          </div>
          <div className="text-xl font-bold text-mint">
            {currencySymbol("INR")}
            {totalContributed.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="stat-card" style={{ "--accent": "var(--amber)" } as React.CSSProperties}>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
            Pending
          </div>
          <div className="text-xl font-bold text-amber">{pendingCount}</div>
        </div>
        <div className="stat-card" style={{ "--accent": "var(--mint)" } as React.CSSProperties}>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
            Approved
          </div>
          <div className="text-xl font-bold text-mint">{approvedCount}</div>
        </div>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-4 p-4 rounded-lg bg-mint/8 border border-mint/20 text-mint text-sm animate-fade-in">
          Payment submitted! Your donation is pending admin approval.
        </div>
      )}

      {/* Submission form */}
      {showForm && (
        <div className="glass-card p-6 mb-6 animate-scale-in">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-5">
            New Donation
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {/* Amount */}
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Amount
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  min="1"
                  step="any"
                  required
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[var(--border-active)] transition-colors"
                />
              </div>
              {/* Currency */}
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Currency
                </label>
                <Dropdown
                  value={currency}
                  options={[
                    { value: "INR", label: "INR (₹)" },
                    { value: "USD", label: "USD ($)" },
                  ]}
                  onChange={setCurrency}
                />
              </div>
              {/* Method */}
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Method
                </label>
                <Dropdown
                  value={method}
                  options={[
                    { value: "UPI", label: "UPI" },
                    { value: "BMC", label: "Buy Me a Coffee" },
                    { value: "BANK", label: "Bank Transfer" },
                    { value: "OTHER", label: "Other" },
                  ]}
                  onChange={setMethod}
                />
              </div>
            </div>

            {/* Reference / proof note */}
            <div className="mb-5">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Reference / Proof Note
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UPI transaction ID, receipt number, or any reference"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[var(--border-active)] transition-colors"
              />
              <p className="text-text-tertiary text-[11px] mt-1.5">
                Add a payment reference to help admins verify your donation
              </p>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-coral/8 border border-coral/20 text-coral text-sm">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !amount}
              className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Donation"}
            </button>
          </form>
        </div>
      )}

      {/* Filter tabs */}
      {transactions.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                statusFilter === s
                  ? s === "APPROVED"
                    ? "bg-mint/20 text-mint border-mint/30"
                    : s === "PENDING"
                      ? "bg-amber/20 text-amber border-amber/30"
                      : s === "REJECTED"
                        ? "bg-coral/20 text-coral border-coral/30"
                        : "bg-lime/20 text-lime border-lime/30"
                  : "bg-bg-deep text-text-secondary border-[var(--border)] hover:text-text-primary"
              }`}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              {s !== "ALL" && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {transactions.filter((t) => t.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Transaction list */}
      {filteredTransactions.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">
            {statusFilter === "ALL"
              ? "No donations yet."
              : `No ${statusFilter.toLowerCase()} donations.`}
          </p>
          {statusFilter === "ALL" && (
            <p className="text-text-tertiary text-sm">
              Submit your first donation to support the community.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="card p-4 flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {tx.description}
                </div>
                <div className="text-text-tertiary text-xs mt-1">
                  {new Date(tx.date).toLocaleDateString()} &middot; {tx.method}
                  {tx.currency !== "INR" && (
                    <span className="ml-1">&middot; {tx.currency}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-mint font-semibold">
                  {currencySymbol(tx.currency)}
                  {parseFloat(tx.amount).toLocaleString()}
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
