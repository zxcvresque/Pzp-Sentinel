"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";

interface Subscription {
  id: string;
  platform: string;
  planUrl: string | null;
  price: string;
  currency: string;
  frequency: string;
  status: string;
  expiryDate: string;
  lastRenewalDate: string | null;
  createdAt: string;
}

const EMPTY_FORM = {
  platform: "",
  price: "",
  frequency: "MONTHLY",
  expiryDate: "",
  planUrl: "",
  currency: "INR",
};

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((data) => setSubs(data.subscriptions || []))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function startEdit(sub: Subscription) {
    setForm({
      platform: sub.platform,
      price: parseFloat(sub.price).toString(),
      frequency: sub.frequency,
      expiryDate: sub.expiryDate.slice(0, 10),
      planUrl: sub.planUrl || "",
      currency: sub.currency,
    });
    setEditingId(sub.id);
    setShowForm(true);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const payload = {
      platform: form.platform,
      price: parseFloat(form.price),
      frequency: form.frequency,
      expiryDate: form.expiryDate,
      planUrl: form.planUrl || null,
      currency: form.currency,
    };

    if (editingId) {
      const res = await fetch(`/api/subscriptions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSubs((prev) =>
          prev.map((s) => (s.id === editingId ? data.subscription : s)),
        );
        resetForm();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update subscription");
      }
    } else {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setSubs((prev) => [data.subscription, ...prev]);
        resetForm();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create subscription");
      }
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this subscription?")) return;
    const res = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSubs((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) resetForm();
    }
  }

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const monthlyCost = activeSubs.reduce((sum, s) => {
    const price = parseFloat(s.price);
    return sum + (s.frequency === "YEARLY" ? price / 12 : s.frequency === "ONE_TIME" ? 0 : price);
  }, 0);

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-20 w-full mb-4" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Active <span className="font-display text-lime">Subscriptions</span>
        </h1>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "Add Subscription"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Active</div>
          <div className="text-3xl font-extrabold text-mint">{activeSubs.length}</div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Monthly Burn</div>
          <div className="text-3xl font-extrabold text-coral">₹{Math.round(monthlyCost).toLocaleString("en-IN")}</div>
        </div>
        <div className="card p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Total Tracked</div>
          <div className="text-3xl font-extrabold">{subs.length}</div>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-coral/8 border border-coral/20 text-coral text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Platform
              </label>
              <input
                type="text"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                placeholder="e.g. Vercel, Supabase"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Price
              </label>
              <input
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Frequency
              </label>
              <Dropdown
                value={form.frequency}
                options={[
                  { value: "MONTHLY", label: "Monthly" },
                  { value: "YEARLY", label: "Yearly" },
                  { value: "ONE_TIME", label: "One Time" },
                ]}
                onChange={(val) => setForm({ ...form, frequency: val })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Expiry Date
              </label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Plan URL
              </label>
              <input
                type="url"
                value={form.planUrl}
                onChange={(e) => setForm({ ...form, planUrl: e.target.value })}
                placeholder="https://..."
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Currency
              </label>
              <Dropdown
                value={form.currency}
                options={[
                  { value: "INR", label: "INR" },
                  { value: "USD", label: "USD" },
                ]}
                onChange={(val) => setForm({ ...form, currency: val })}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !form.platform || !form.price || !form.expiryDate}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting
              ? editingId
                ? "Saving..."
                : "Creating..."
              : editingId
                ? "Save Changes"
                : "Create Subscription"}
          </button>
        </form>
      )}

      {subs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No subscriptions tracked yet.</p>
          <p className="text-text-tertiary text-sm">Click Add Subscription to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((sub) => {
            const isExpired = new Date(sub.expiryDate) < new Date();
            return (
              <div key={sub.id} className="card p-5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">
                    {sub.platform}
                    {sub.planUrl && (
                      <a
                        href={sub.planUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-tertiary text-xs hover:text-lime transition-colors"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <div className="text-text-tertiary text-xs mt-1">
                    {sub.frequency.toLowerCase()} · expires {new Date(sub.expiryDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-extrabold">
                    {sub.currency === "INR" ? "₹" : "$"}
                    {parseFloat(sub.price).toLocaleString()}
                  </span>
                  <span
                    className={`status-tag ${
                      sub.status === "ACTIVE" && !isExpired
                        ? "status-approved"
                        : sub.status === "CANCELLED"
                          ? "status-rejected"
                          : "status-pending"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {isExpired && sub.status === "ACTIVE" ? "OVERDUE" : sub.status}
                  </span>
                  <button
                    onClick={() => startEdit(sub)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(sub.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
