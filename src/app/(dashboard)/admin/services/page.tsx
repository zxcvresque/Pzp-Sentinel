"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";
import FormExample from "@/components/FormExample";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageTour from "@/components/PageTour";
import ServicesNav from "@/components/ServicesNav";

interface ColumnDef {
  key: string;
  label: string;
  type: string;
}

interface Service {
  id: string;
  category: string;
  name: string;
  columns: ColumnDef[] | null;
  entries: Record<string, string>[] | null;
  price: string | null;
  currency: string | null;
  frequency: string | null;
  planUrl: string | null;
  expiryDate: string | null;
  status: string | null;
  autoRenew?: boolean;
  vpsServer?: { id: string; name: string } | null;
  createdAt: string;
}

const emptyColumn = (): ColumnDef => ({ key: "", label: "", type: "text" });

function formatCurrency(price: string, currency: string | null) {
  const sym = currency === "USD" ? "$" : "₹";
  return `${sym}${parseFloat(price).toLocaleString()}`;
}

function frequencyLabel(f: string | null) {
  if (f === "YEARLY") return "/yr";
  if (f === "WEEKLY") return "/wk";
  if (f === "ONE_TIME") return " one-time";
  if (f === "LIFETIME") return " lifetime";
  return "/mo";
}

function expiryInfo(date: string | null): { label: string; color: string } | null {
  if (!date) return null;
  const now = new Date();
  const exp = new Date(date);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
  if (daysLeft < 0) return { label: "Expired", color: "var(--coral)" };
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, color: "var(--coral)" };
  if (daysLeft <= 7) return { label: `${daysLeft}d left`, color: "var(--amber)" };
  if (daysLeft <= 30) return { label: `${daysLeft}d left`, color: "var(--amber)" };
  return { label: exp.toLocaleDateString(), color: "var(--text-tertiary)" };
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([emptyColumn()]);
  const [entries, setEntries] = useState<Record<string, string>[]>([]);

  // subscription fields
  const [trackCost, setTrackCost] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [planUrl, setPlanUrl] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [subStatus, setSubStatus] = useState("ACTIVE");
  const [recordPayment, setRecordPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("OTHER");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchServices = () => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((data) => setServices(data.services || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setCategory("");
    setName("");
    setColumns([emptyColumn()]);
    setEntries([]);
    setTrackCost(false);
    setPrice("");
    setCurrency("INR");
    setFrequency("MONTHLY");
    setPlanUrl("");
    setExpiryDate("");
    setSubStatus("ACTIVE");
    setRecordPayment(false);
    setPaymentMethod("OTHER");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setFormError("");
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (svc: Service) => {
    setEditingId(svc.id);
    setCategory(svc.category);
    setName(svc.name);
    setColumns(svc.columns && svc.columns.length > 0 ? svc.columns : [emptyColumn()]);
    setEntries(svc.entries || []);
    const hasCost = svc.price != null;
    setTrackCost(hasCost);
    setPrice(hasCost ? parseFloat(svc.price!).toString() : "");
    setCurrency(svc.currency || "INR");
    setFrequency(svc.frequency || "MONTHLY");
    setPlanUrl(svc.planUrl || "");
    setExpiryDate(svc.expiryDate ? svc.expiryDate.slice(0, 10) : "");
    setSubStatus(svc.status || "ACTIVE");
    setRecordPayment(false);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!category.trim() || !name.trim()) return;
    setSaving(true);
    setFormError("");

    const validColumns = columns.filter((c) => c.key.trim() && c.label.trim());
    const payload: Record<string, unknown> = {
      category: category.trim(),
      name: name.trim(),
      columns: validColumns.length > 0 ? validColumns : null,
      entries: entries.length > 0 ? entries : null,
    };

    if (trackCost && price) {
      payload.price = parseFloat(price);
      payload.currency = currency;
      payload.frequency = frequency;
      payload.planUrl = planUrl || null;
      payload.expiryDate = expiryDate || null;
      payload.status = subStatus;
      if (!editingId && recordPayment) {
        payload.recordPayment = true;
        payload.paymentMethod = paymentMethod;
        payload.paymentDate = paymentDate || null;
      }
    } else {
      // Clear subscription fields if cost tracking is off
      payload.price = null;
      payload.currency = null;
      payload.frequency = null;
      payload.planUrl = null;
      payload.expiryDate = null;
      payload.status = null;
    }

    try {
      if (editingId) {
        const res = await fetch(`/api/services/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to update");
        }
      } else {
        const res = await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to create");
        }
      }
      resetForm();
      fetchServices();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save service");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/services/${deleteTarget}`, { method: "DELETE" });
      fetchServices();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // column helpers
  const updateColumn = (idx: number, field: keyof ColumnDef, value: string) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };
  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);
  const removeColumn = (idx: number) =>
    setColumns((prev) => prev.filter((_, i) => i !== idx));

  // entry helpers
  const addEntry = () => {
    const row: Record<string, string> = {};
    columns.forEach((c) => {
      if (c.key.trim()) row[c.key] = "";
    });
    setEntries((prev) => [...prev, row]);
  };
  const updateEntry = (rowIdx: number, key: string, value: string) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === rowIdx ? { ...e, [key]: value } : e)),
    );
  };
  const removeEntry = (idx: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== idx));

  // Stats
  const paidServices = services.filter((s) => s.price != null);
  const activeCount = paidServices.filter((s) => s.status === "ACTIVE").length;
  const monthlyCost = paidServices
    .filter((s) => s.status === "ACTIVE")
    .reduce((sum, s) => {
      const p = parseFloat(s.price!);
      if (s.frequency === "YEARLY") return sum + p / 12;
      if (s.frequency === "WEEKLY") return sum + (p * 52) / 12;
      if (s.frequency === "ONE_TIME" || s.frequency === "LIFETIME") return sum;
      return sum + p;
    }, 0);

  const grouped = services.reduce<Record<string, Service[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  const validColumnsForEntries = columns.filter((c) => c.key.trim() && c.label.trim());

  return (
    <div>
      <ServicesNav role="ADMIN" />
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this service?"
        message="This cannot be undone"
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Service <span className="font-display text-lime">Catalog</span>
        </h1>
        {!showForm && (
          <button
            onClick={openCreateForm}
            className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90"
          >
            Add Service
          </button>
        )}
      </div>

      {/* Stats bar — only shows when there are paid services */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div data-tour="service-stats" className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Active Subscriptions</div>
            <div className="text-3xl font-extrabold text-mint">{activeCount}</div>
          </div>
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Monthly Burn</div>
            <div className="text-3xl font-extrabold text-coral">₹{Math.round(monthlyCost).toLocaleString("en-IN")}</div>
          </div>
          <div className="card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">Total Services</div>
            <div className="text-3xl font-extrabold">{services.length}</div>
          </div>
      </div>

      {showForm && (
        <div className="card p-6 mb-8">
          <h2 className="text-sm font-semibold mb-4">
            {editingId ? "Edit Service" : "New Service"}
          </h2>
          <FormExample lines={["Category: Infrastructure · Name: Supabase", "Enable 'Track recurring cost' for subscriptions", "Price: 2500 · Frequency: Monthly · Expiry: next renewal date"]} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                Category
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Infrastructure"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cloud Hosting"
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
          </div>

          {/* Columns */}
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Columns
            </label>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={col.key}
                    onChange={(e) => updateColumn(idx, "key", e.target.value)}
                    placeholder="key"
                    className="flex-1 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  <input
                    value={col.label}
                    onChange={(e) => updateColumn(idx, "label", e.target.value)}
                    placeholder="label"
                    className="flex-1 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  <input
                    value={col.type}
                    onChange={(e) => updateColumn(idx, "type", e.target.value)}
                    placeholder="type"
                    className="w-24 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                  />
                  {columns.length > 1 && (
                    <button
                      onClick={() => removeColumn(idx)}
                      className="text-xs text-coral hover:text-coral/80"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addColumn}
              className="text-xs text-lime hover:text-lime/80 mt-2"
            >
              + Add column
            </button>
          </div>

          {/* Entries (only when columns are defined) */}
          {validColumnsForEntries.length > 0 && (
            <div className="mb-4">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Entries
              </label>
              {entries.length > 0 && (
                <div className="overflow-x-auto mb-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {validColumnsForEntries.map((col) => (
                          <th
                            key={col.key}
                            className="text-left px-2 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"
                          >
                            {col.label}
                          </th>
                        ))}
                        <th className="w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, rowIdx) => (
                        <tr key={rowIdx} className="border-b border-[var(--border)] last:border-0">
                          {validColumnsForEntries.map((col) => (
                            <td key={col.key} className="px-2 py-1.5">
                              <input
                                value={entry[col.key] || ""}
                                onChange={(e) =>
                                  updateEntry(rowIdx, col.key, e.target.value)
                                }
                                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => removeEntry(rowIdx)}
                              className="text-xs text-coral hover:text-coral/80"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                onClick={addEntry}
                className="text-xs text-lime hover:text-lime/80"
              >
                + Add entry
              </button>
            </div>
          )}

          {/* Cost tracking toggle + fields */}
          <div className="mb-4 pt-3 border-t border-[var(--border)]">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trackCost}
                onChange={(e) => { setTrackCost(e.target.checked); if (!e.target.checked) setRecordPayment(false); }}
                className="w-4 h-4 rounded accent-[var(--lime)]"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Track recurring cost
              </span>
            </label>

            {trackCost && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Price
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setPrice(e.target.value); }}
                    placeholder="0.00"
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Currency
                  </label>
                  <Dropdown
                    value={currency}
                    options={[
                      { value: "INR", label: "INR" },
                      { value: "USD", label: "USD" },
                    ]}
                    onChange={(val) => setCurrency(val)}
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Frequency
                  </label>
                  <Dropdown
                    value={frequency}
                    options={[
                      { value: "MONTHLY", label: "Monthly" },
                      { value: "YEARLY", label: "Yearly" },
                      { value: "ONE_TIME", label: "One Time" },
                    ]}
                    onChange={(val) => setFrequency(val)}
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Plan URL
                  </label>
                  <input
                    type="url"
                    value={planUrl}
                    onChange={(e) => setPlanUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
                    Status
                  </label>
                  <Dropdown
                    value={subStatus}
                    options={[
                      { value: "ACTIVE", label: "Active" },
                      { value: "CANCELLED", label: "Cancelled" },
                      { value: "EXPIRED", label: "Expired" },
                    ]}
                    onChange={(val) => setSubStatus(val)}
                  />
                </div>
              </div>
            )}

            {trackCost && !editingId && (
              <div className="mt-4 rounded-xl border border-mint/15 bg-mint/[.035] p-4">
                <label className="flex cursor-pointer items-start gap-2.5 select-none">
                  <input
                    type="checkbox"
                    checked={recordPayment}
                    onChange={(event) => setRecordPayment(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-[var(--lime)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">Record payment now</span>
                    <span className="mt-0.5 block text-xs leading-5 text-text-tertiary">Create and link an approved expense transaction for this service price.</span>
                  </span>
                </label>
                {recordPayment && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Payment source</label>
                      <Dropdown
                        value={paymentMethod}
                        options={[
                          { value: "OTHER", label: "Admin noted / card / other" },
                          { value: "BANK", label: "Bank transfer" },
                          { value: "UPI", label: "Direct UPI" },
                        ]}
                        onChange={setPaymentMethod}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Payment date</label>
                      <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 text-text-primary outline-none focus:border-lime/30" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {formError && <p role="alert" className="mb-3 text-sm text-coral">{formError}</p>}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={saving || !category.trim() || !name.trim() || (recordPayment && !price)}
              className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Update Service" : "Create Service"}
            </button>
            <button
              onClick={resetForm}
              className="px-5 py-2.5 rounded-full text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {services.length === 0 && !showForm ? (
        <div data-tour="service-catalog" className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No services catalogued yet.</p>
          <p className="text-text-tertiary text-sm">
            Click &quot;Add Service&quot; above to start tracking what the community uses.
          </p>
        </div>
      ) : (
        <div data-tour="service-catalog" className="space-y-8">
          {Object.entries(grouped).map(([categoryName, items]) => (
            <div key={categoryName}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                {categoryName}
              </h2>
              <div className="space-y-3">
                {items.map((svc) => {
                  const hasCost = svc.price != null;
                  const expiry = expiryInfo(svc.expiryDate);
                  const isExpired = svc.expiryDate ? new Date(svc.expiryDate) < new Date() : false;

                  return (
                    <div key={svc.id} className="card p-5">
                      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="text-sm font-semibold">{svc.name}</div>
                          {svc.vpsServer && (
                            <span
                              className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                              style={{
                                color: "var(--lime)",
                                background: "rgba(111,209,215,0.10)",
                                border: "1px solid rgba(111,209,215,0.25)",
                              }}
                              title={`Linked to VPS: ${svc.vpsServer.name}`}
                            >
                              VPS
                            </span>
                          )}
                          {svc.autoRenew && (
                            <span
                              className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]"
                              style={{ color: "var(--mint)", background: "rgba(52,211,153,0.08)" }}
                              title="Auto-renews each cycle"
                            >
                              Auto-renew
                            </span>
                          )}
                          {svc.planUrl && (
                            <a
                              href={svc.planUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-text-tertiary text-xs hover:text-lime transition-colors"
                            >
                              ↗
                            </a>
                          )}
                          {hasCost && (
                            <span className="text-sm font-bold text-text-primary">
                              {formatCurrency(svc.price!, svc.currency)}
                              <span className="text-text-tertiary font-normal text-xs">
                                {frequencyLabel(svc.frequency)}
                              </span>
                            </span>
                          )}
                          {hasCost && svc.status && (
                            <span
                              className={`status-tag ${
                                svc.status === "ACTIVE" && !isExpired
                                  ? "status-approved"
                                  : svc.status === "CANCELLED"
                                    ? "status-rejected"
                                    : "status-pending"
                              }`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {isExpired && svc.status === "ACTIVE" ? "OVERDUE" : svc.status}
                            </span>
                          )}
                          {expiry && (
                            <span
                              className="font-mono text-[10px]"
                              style={{ color: expiry.color }}
                            >
                              {expiry.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => openEditForm(svc)}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(svc.id)}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {svc.columns && svc.entries && svc.entries.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[var(--border)]">
                                {svc.columns.map((col) => (
                                  <th
                                    key={col.key}
                                    className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary"
                                  >
                                    {col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {svc.entries.map((entry, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-[var(--border)] last:border-0"
                                >
                                  {svc.columns!.map((col) => (
                                    <td
                                      key={col.key}
                                      className="px-3 py-2 text-text-secondary"
                                    >
                                      {entry[col.key] || "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <PageTour pageKey="admin-services" />
    </div>
  );
}
