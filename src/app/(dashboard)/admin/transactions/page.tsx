"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";

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
  proofFileId?: string | null;
  attachments?: string[];
  reviewNote?: string | null;
  fromUser?: { name: string } | null;
  createdBy?: { name: string } | null;
  reviewedBy?: { name: string } | null;
}

interface UserOption {
  id: string;
  name: string;
  telegramUser: string | null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [directionFilter, setDirectionFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [method, setMethod] = useState("UPI");
  const [direction, setDirection] = useState("OUT");
  const [type, setType] = useState("EXPENSE");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [fromUserId, setFromUserId] = useState("");

  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [viewingAttachments, setViewingAttachments] = useState<string[] | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  useEffect(() => {
    fetchTransactions();
  }, []);

  useEffect(() => {
    if (direction === "IN" && users.length === 0) {
      fetchUsers();
    }
  }, [direction, users.length]);

  async function fetchUsers() {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        console.error("Failed to fetch users:", res.status);
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setUsersLoading(false);
    }
  }

  async function fetchTransactions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions?limit=100");
      if (!res.ok) {
        setError(`Failed to load transactions (${res.status})`);
        setTransactions([]);
        return;
      }
      const data = await res.json();
      setTransactions(data.transactions || []);
    } catch (err) {
      setError("Network error loading transactions");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setAmount("");
    setCurrency("INR");
    setMethod("UPI");
    setDirection("OUT");
    setType("EXPENSE");
    setDescription("");
    setDate("");
    setFromUserId("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(tx: Transaction) {
    setEditingId(tx.id);
    setAmount(parseFloat(tx.amount).toString());
    setCurrency(tx.currency || "INR");
    setMethod(tx.method);
    setDirection(tx.direction);
    setType(tx.type);
    setDescription(tx.description);
    setDate(tx.date ? new Date(tx.date).toISOString().split("T")[0] : "");
    setShowForm(true);
  }

  function startCreate() {
    if (editingId) resetForm();
    setShowForm(!showForm);
  }

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/transactions/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to approve");
        return;
      }
      const data = await res.json();
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...data.transaction, status: "APPROVED" } : t))
      );
    } catch {
      alert("Network error approving transaction");
    }
  }

  async function handleReject(id: string) {
    const reason = prompt("Rejection reason (optional):");
    try {
      const res = await fetch(`/api/transactions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to reject");
        return;
      }
      const data = await res.json();
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...data.transaction, status: "REJECTED" } : t))
      );
    } catch {
      alert("Network error rejecting transaction");
    }
  }

  async function handleDelete(tx: Transaction) {
    if (!confirm(`Delete transaction "${tx.description}" for ${tx.currency === "INR" ? "₹" : "$"}${parseFloat(tx.amount).toLocaleString()}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" });
      if (res.ok) {
        setTransactions((prev) => prev.filter((t) => t.id !== tx.id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete transaction");
      }
    } catch {
      alert("Network error deleting transaction");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingId) {
        const res = await fetch(`/api/transactions/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, currency, method, direction, type, description, date: date || undefined }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Failed to update transaction");
          return;
        }
        const data = await res.json();
        setTransactions((prev) =>
          prev.map((t) => (t.id === editingId ? data.transaction : t))
        );
        resetForm();
      } else {
        const body: Record<string, unknown> = { amount, currency, method, direction, type, description };
        if (direction === "IN" && fromUserId) {
          body.fromUserId = fromUserId;
        }
        const res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Failed to create transaction");
          return;
        }
        const data = await res.json();
        setTransactions((prev) => [data.transaction, ...prev]);
        resetForm();
      }
    } catch {
      alert("Network error saving transaction");
    } finally {
      setSubmitting(false);
    }
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

  const selectClass = "w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30";
  const labelClass = "font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2";

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-coral/10 border border-coral/20 text-coral text-sm">
          {error}
          <button onClick={fetchTransactions} className="ml-3 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          All <span className="font-display text-lime">Transactions</span>
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (statusFilter !== "ALL") params.set("status", statusFilter);
              if (directionFilter !== "ALL") params.set("direction", directionFilter);
              const qs = params.toString();
              window.open(`/api/transactions/export${qs ? `?${qs}` : ""}`, "_blank");
            }}
            className="font-mono text-[10px] uppercase tracking-[0.08em] px-4 py-2.5 rounded-full border border-[var(--border)] text-text-secondary hover:border-[var(--border-hover)] hover:text-text-primary transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 10.667v2.666A1.333 1.333 0 0 1 12.667 14.667H3.333A1.333 1.333 0 0 1 2 13.333v-2.666M11.333 5.333 8 2 4.667 5.333M8 2v8.667" transform="scale(1,-1) translate(0,-16)" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={startCreate}
            className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
          >
            {showForm && !editingId ? "Cancel" : "Log Transaction"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">
              {editingId ? "Edit Transaction" : "New Transaction"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border border-[var(--border)] text-text-secondary hover:border-[var(--border-hover)] transition-colors"
              >
                Cancel Edit
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className={labelClass}>Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                required
                className={selectClass}
              />
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <Dropdown
                value={currency}
                options={[
                  { value: "INR", label: "INR (₹)" },
                  { value: "USD", label: "USD ($)" },
                ]}
                onChange={setCurrency}
              />
            </div>
            <div>
              <label className={labelClass}>Direction</label>
              <Dropdown
                value={direction}
                options={[
                  { value: "OUT", label: "Expense (OUT)" },
                  { value: "IN", label: "Income (IN)" },
                ]}
                onChange={(val) => {
                  setDirection(val);
                  if (val !== "IN") setFromUserId("");
                }}
              />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <Dropdown
                value={type}
                options={[
                  { value: "EXPENSE", label: "Expense" },
                  { value: "SUBSCRIPTION", label: "Subscription" },
                  { value: "DONATION", label: "Donation" },
                  { value: "OTHER", label: "Other" },
                ]}
                onChange={setType}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className={labelClass}>Method</label>
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
            <div>
              <label className={labelClass}>Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this for?"
                required
                className={selectClass}
              />
            </div>
            {editingId ? (
              <div>
                <label className={labelClass}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={selectClass}
                />
              </div>
            ) : direction === "IN" ? (
              <div>
                <label className={labelClass}>From User</label>
                <Dropdown
                  value={fromUserId}
                  options={[
                    { value: "", label: usersLoading ? "Loading users..." : "-- Select user (optional) --" },
                    ...users.map((u) => ({
                      value: u.id,
                      label: `${u.name}${u.telegramUser ? ` (@${u.telegramUser})` : ""}`,
                    })),
                  ]}
                  onChange={setFromUserId}
                  placeholder={usersLoading ? "Loading users..." : "-- Select user (optional) --"}
                />
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={submitting || !amount || !description}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting
              ? editingId ? "Saving..." : "Logging..."
              : editingId ? "Save Changes" : "Log Transaction"}
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
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className={`border-b border-[var(--border)] last:border-0 hover:bg-[rgba(255,255,255,0.03)] transition-colors cursor-pointer ${editingId === tx.id ? "bg-[rgba(99,102,241,0.06)]" : ""}`}
                  >
                    <td className="p-4 text-sm">
                      <div className="flex items-center gap-1.5">
                        <span>{tx.description}</span>
                        {tx.attachments && tx.attachments.length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-mint/10 text-mint flex-shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="2" width="12" height="12" rx="2" />
                              <circle cx="5.5" cy="5.5" r="1" />
                              <path d="M14 10l-3.3-3.3a1 1 0 0 0-1.4 0L2 14" />
                            </svg>
                            <span className="text-[10px] font-semibold">{tx.attachments.length}</span>
                          </span>
                        )}
                      </div>
                      {tx.fromUser && (
                        <div className="text-text-tertiary text-xs mt-0.5">from {tx.fromUser.name}</div>
                      )}
                      {tx.createdBy && !tx.fromUser && (
                        <div className="text-text-tertiary text-xs mt-0.5">by {tx.createdBy.name}</div>
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
                      {(tx.status === "APPROVED" || tx.status === "REJECTED") && tx.reviewedBy && (
                        <div className="text-text-tertiary text-[10px] mt-1">by {tx.reviewedBy.name}</div>
                      )}
                    </td>
                    <td className="p-4 text-right text-text-secondary text-sm">
                      {formatDate(tx.date)}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex gap-1 justify-center flex-wrap" onClick={(e) => e.stopPropagation()}>
                        {tx.status === "PENDING" && (
                          <>
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
                          </>
                        )}
                        <button
                          onClick={() => startEdit(tx)}
                          className="px-3 py-1 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
                        >
                          Edit
                        </button>
                        {tx.status === "PENDING" && (
                          <button
                            onClick={() => handleDelete(tx)}
                            className="px-3 py-1 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transaction detail modal */}
      {selectedTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedTx(null)}
        >
          <div
            className="relative bg-bg-surface border border-[var(--border)] rounded-2xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-bg-surface border-b border-[var(--border)] px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <span className={`status-tag ${
                  selectedTx.status === "APPROVED" ? "status-approved" : selectedTx.status === "PENDING" ? "status-pending" : "status-rejected"
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {selectedTx.status}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] text-text-secondary">
                  {selectedTx.type}
                </span>
              </div>
              <button
                onClick={() => setSelectedTx(null)}
                className="w-8 h-8 rounded-full bg-bg-deep hover:bg-[var(--border)] flex items-center justify-center transition-colors text-text-secondary hover:text-text-primary"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              {/* Amount */}
              <div className="mb-6">
                <div className={`text-3xl font-bold ${selectedTx.direction === "IN" ? "text-mint" : "text-coral"}`}>
                  {selectedTx.direction === "IN" ? "+" : "-"}
                  {selectedTx.currency === "INR" ? "₹" : "$"}
                  {parseFloat(selectedTx.amount).toLocaleString()}
                </div>
                <div className="text-text-secondary text-sm mt-1">{selectedTx.description}</div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-bg-deep rounded-xl p-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-1">Direction</div>
                  <div className={`text-sm font-semibold ${selectedTx.direction === "IN" ? "text-mint" : "text-coral"}`}>
                    {selectedTx.direction === "IN" ? "Incoming" : "Outgoing"}
                  </div>
                </div>
                <div className="bg-bg-deep rounded-xl p-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-1">Method</div>
                  <div className="text-sm font-semibold text-violet">{selectedTx.method}</div>
                </div>
                <div className="bg-bg-deep rounded-xl p-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-1">Currency</div>
                  <div className="text-sm font-semibold text-text-primary">{selectedTx.currency}</div>
                </div>
                <div className="bg-bg-deep rounded-xl p-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-1">Date</div>
                  <div className="text-sm font-semibold text-text-primary">{formatDate(selectedTx.date)}</div>
                </div>
              </div>

              {/* People */}
              <div className="space-y-3 mb-6">
                {selectedTx.fromUser && (
                  <div className="flex items-center gap-3 bg-bg-deep rounded-xl p-4">
                    <div className="w-8 h-8 rounded-full bg-amber/15 text-amber flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {selectedTx.fromUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">Donor</div>
                      <div className="text-sm font-medium text-text-primary">{selectedTx.fromUser.name}</div>
                    </div>
                  </div>
                )}
                {selectedTx.createdBy && (
                  <div className="flex items-center gap-3 bg-bg-deep rounded-xl p-4">
                    <div className="w-8 h-8 rounded-full bg-violet/15 text-violet flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {selectedTx.createdBy.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">Created by</div>
                      <div className="text-sm font-medium text-text-primary">{selectedTx.createdBy.name}</div>
                    </div>
                  </div>
                )}
                {selectedTx.reviewedBy && (
                  <div className="flex items-center gap-3 bg-bg-deep rounded-xl p-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      selectedTx.status === "APPROVED" ? "bg-mint/15 text-mint" : "bg-coral/15 text-coral"
                    }`}>
                      {selectedTx.reviewedBy.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
                        {selectedTx.status === "APPROVED" ? "Approved by" : "Rejected by"}
                      </div>
                      <div className="text-sm font-medium text-text-primary">{selectedTx.reviewedBy.name}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Review note */}
              {selectedTx.reviewNote && (
                <div className="mb-6 bg-bg-deep rounded-xl p-4">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Review Note</div>
                  <div className="text-sm text-text-secondary italic">{selectedTx.reviewNote}</div>
                </div>
              )}

              {/* Attachments / receipt photos */}
              {selectedTx.attachments && selectedTx.attachments.length > 0 && (
                <div className="mb-6">
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                    Receipt Photos ({selectedTx.attachments.length})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {selectedTx.attachments.map((url, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightboxImg(url)}
                        className="block rounded-xl overflow-hidden border border-[var(--border)] hover:border-[var(--border-hover)] transition-all hover:shadow-lg group"
                      >
                        <img
                          src={url}
                          alt={`Receipt ${i + 1}`}
                          className="w-full h-40 object-cover group-hover:scale-[1.02] transition-transform"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
                {selectedTx.status === "PENDING" && (
                  <>
                    <button
                      onClick={() => { handleApprove(selectedTx.id); setSelectedTx(null); }}
                      className="px-4 py-2 rounded-full text-sm font-semibold bg-mint/10 text-mint hover:bg-mint/20 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => { handleReject(selectedTx.id); setSelectedTx(null); }}
                      className="px-4 py-2 rounded-full text-sm font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  onClick={() => { startEdit(selectedTx); setSelectedTx(null); }}
                  className="px-4 py-2 rounded-full text-sm font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
                >
                  Edit
                </button>
                {selectedTx.status === "PENDING" && (
                  <button
                    onClick={() => { handleDelete(selectedTx); setSelectedTx(null); }}
                    className="px-4 py-2 rounded-full text-sm font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors ml-auto"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in cursor-zoom-out"
          onClick={() => setLightboxImg(null)}
        >
          <img
            src={lightboxImg}
            alt="Receipt"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
          <button
            onClick={() => setLightboxImg(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white text-xl"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
