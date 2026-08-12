"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import Dropdown from "@/components/Dropdown";
import PageTour from "@/components/PageTour";

interface Person {
  id?: string;
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
}

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
  attachments: string[];
  reviewNote?: string | null;
  fromUser?: Person | null;
  createdBy?: Person | null;
  reviewedBy?: Person | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  voidedBy?: Person | null;
}

interface UserOption { id: string; name: string; telegramUser: string | null }
type ActionKind = "APPROVE" | "REJECT" | "VOID";

const defaultFilters = {
  status: "ALL", direction: "ALL", currency: "ALL", type: "ALL", method: "ALL",
  lifecycle: "ACTIVE", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", sort: "newest",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function money(tx: Transaction) {
  return `${tx.direction === "IN" ? "+" : "-"}${tx.currency === "INR" ? "₹" : "$"}${Number(tx.amount).toLocaleString()}`;
}

function ActionDialog({ open, action, count, loading, onClose, onConfirm }: {
  open: boolean; action: ActionKind; count: number; loading: boolean;
  onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  const needsReason = action !== "APPROVE";
  const label = action === "APPROVE" ? "Approve" : action === "REJECT" ? "Reject" : "Void";
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={() => { if (!loading) { setReason(""); onClose(); } }}>
      <form className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim()); }}>
        <h2 className="text-lg font-bold text-text-primary">{label} {count === 1 ? "transaction" : `${count} transactions`}?</h2>
        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
          {action === "VOID" ? "The ledger entries and audit history will be retained, but voided entries stop affecting balances and reports." : `Only pending transactions can be ${label.toLowerCase()}d.`}
        </p>
        {needsReason && <div className="mt-4">
          <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{action === "VOID" ? "Void" : "Rejection"} reason</label>
          <textarea autoFocus required maxLength={500} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-bg-deep px-4 py-3 text-sm outline-none focus:border-lime/30" placeholder={`Why ${action === "VOID" ? "should these entries be voided" : "were these transactions rejected"}?`} />
          <div className="mt-1 text-right font-mono text-[9px] text-text-tertiary">{reason.length}/500</div>
        </div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={loading} onClick={() => { setReason(""); onClose(); }} className="rounded-lg px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-[var(--bg-hover)]">Cancel</button>
          <button disabled={loading || (needsReason && !reason.trim())} className={`rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 ${action === "APPROVE" ? "bg-mint/10 text-mint" : "bg-coral/10 text-coral"}`}>{loading ? `${label}ing...` : label}</button>
        </div>
      </form>
    </div>, document.body,
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<{ kind: ActionKind; ids: string[] } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewedEditConfirm, setReviewedEditConfirm] = useState(false);
  const [pendingReviewedSubmit, setPendingReviewedSubmit] = useState(false);
  const [form, setForm] = useState({ amount: "", currency: "INR", method: "UPI", direction: "OUT", type: "EXPENSE", description: "", date: "", fromUserId: "", attachments: "" });

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); setSelected(new Set()); }, 350); return () => clearTimeout(timer); }, [searchInput]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: filters.sort, lifecycle: filters.lifecycle });
    if (search) params.set("search", search);
    for (const key of ["status", "direction", "currency", "type", "method"] as const) if (filters[key] !== "ALL") params.set(key, filters[key]);
    for (const key of ["dateFrom", "dateTo", "amountMin", "amountMax"] as const) if (filters[key]) params.set(key, filters[key]);
    return params.toString();
  }, [filters, limit, page, search]);

  const filterQuery = useMemo(() => { const params = new URLSearchParams(queryString); params.delete("page"); params.delete("limit"); return params.toString(); }, [queryString]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/transactions?${queryString}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load transactions");
      setTransactions(data.transactions || []); setTotal(data.total || 0); setTotalPages(data.totalPages || 1);
      if (page > (data.totalPages || 1)) setPage(data.totalPages || 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load transactions"); }
    finally { setLoading(false); }
  }, [page, queryString]);

  useEffect(() => {
    // Data fetching intentionally synchronizes server query state with this view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => { fetch("/api/users").then((r) => r.json()).then((d) => setUsers((d.users || []).filter((u: { roles?: string[] }) => u.roles?.includes("DONOR")))).catch(() => {}); }, []);

  function updateFilter(key: keyof typeof defaultFilters, value: string) { setFilters((current) => ({ ...current, [key]: value })); setPage(1); setSelected(new Set()); }
  function resetForm() { setForm({ amount: "", currency: "INR", method: "UPI", direction: "OUT", type: "EXPENSE", description: "", date: "", fromUserId: "", attachments: "" }); setEditingId(null); setShowCreate(false); }
  function startEdit(tx: Transaction) {
    if (tx.voidedAt) return;
    setShowCreate(false); setEditingId(tx.id);
    setForm({ amount: String(Number(tx.amount)), currency: tx.currency, method: tx.method, direction: tx.direction, type: tx.type, description: tx.description, date: tx.date.slice(0, 10), fromUserId: tx.fromUser?.id || "", attachments: tx.attachments.join("\n") });
    setTimeout(() => document.getElementById(`editor-${tx.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }

  async function submitForm(confirmReviewedEdit = false) {
    setSaving(true); setFeedback(null);
    try {
      const editing = transactions.find((tx) => tx.id === editingId);
      const payload = { ...form, fromUserId: form.direction === "IN" ? form.fromUserId || null : null, attachments: form.attachments.split("\n").map((v) => v.trim()).filter(Boolean), confirmReviewedEdit };
      const response = await fetch(editingId ? `/api/transactions/${editingId}` : "/api/transactions", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (response.status === 409 && editing && editing.status !== "PENDING" && !confirmReviewedEdit) { setPendingReviewedSubmit(true); setReviewedEditConfirm(true); return; }
      if (!response.ok) throw new Error(data.error || "Could not save transaction");
      setFeedback({ tone: "success", text: editingId ? "Transaction updated and audit trail recorded." : "Transaction created." }); resetForm(); await load();
    } catch (e) { setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Could not save transaction" }); }
    finally { setSaving(false); }
  }

  async function runAction(reason: string) {
    if (!action) return;
    setActionLoading(true); setFeedback(null);
    try {
      if (action.ids.length === 1) {
        const id = action.ids[0]; const endpoint = action.kind === "VOID" ? "" : `/${action.kind.toLowerCase()}`;
        const response = await fetch(`/api/transactions/${id}${endpoint}`, { method: action.kind === "VOID" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Action failed");
        setFeedback({ tone: "success", text: `${action.kind === "VOID" ? "Voided" : action.kind === "APPROVE" ? "Approved" : "Rejected"} 1 transaction.` });
      } else {
        const response = await fetch("/api/transactions/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action.kind, ids: action.ids, reason }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Bulk action failed");
        const failures = (data.results || []).filter((result: { success: boolean }) => !result.success);
        const summary = `${data.succeeded}/${data.requested} succeeded${failures.length ? ` · ${failures.length} failed: ${failures.slice(0, 3).map((f: { id: string; error: string }) => `${f.id.slice(-6)} (${f.error})`).join(", ")}${failures.length > 3 ? ` +${failures.length - 3} more` : ""}` : ""}`;
        setFeedback({ tone: failures.length ? "error" : "success", text: summary });
      }
      setSelected(new Set()); setAction(null); await load();
    } catch (e) { setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Action failed" }); }
    finally { setActionLoading(false); }
  }

  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectVisible() { setSelected((current) => { const visibleIds = transactions.map((tx) => tx.id); const all = visibleIds.every((id) => current.has(id)); const next = new Set(current); visibleIds.forEach((id) => all ? next.delete(id) : next.add(id)); return next; }); }
  async function selectAllFiltered() {
    setSelectingAll(true); setFeedback(null);
    try { const response = await fetch(`/api/transactions/selection?${filterQuery}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not select filtered transactions"); setSelected(new Set(data.ids)); }
    catch (e) { setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Could not select filtered transactions" }); }
    finally { setSelectingAll(false); }
  }

  function editor() {
    const editing = transactions.find((tx) => tx.id === editingId);
    return <form id={editingId ? `editor-${editingId}` : undefined} className="border-t border-violet/20 bg-violet/[0.04] p-4 sm:p-6" onSubmit={(e) => { e.preventDefault(); void submitForm(); }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">{editingId ? "Edit transaction" : "New transaction"}</h2>{editing && editing.status !== "PENDING" && <p className="mt-1 text-xs text-amber">Reviewed transaction — saving material changes requires confirmation.</p>}</div><button type="button" onClick={resetForm} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[10px] text-text-secondary">Cancel</button></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Amount"><input required inputMode="decimal" value={form.amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setForm({ ...form, amount: e.target.value })} className="input" /></Field>
        <SelectField label="Currency" value={form.currency} options={[["INR", "INR (₹)"], ["USD", "USD ($)"]]} onChange={(v) => setForm({ ...form, currency: v })} />
        <SelectField label="Direction" value={form.direction} options={[["IN", "Income (IN)"], ["OUT", "Expense (OUT)"]]} onChange={(v) => setForm({ ...form, direction: v, fromUserId: v === "OUT" ? "" : form.fromUserId })} />
        <SelectField label="Type" value={form.type} options={[["DONATION", "Donation"], ["EXPENSE", "Expense"], ["SUBSCRIPTION", "Subscription"], ["OTHER", "Other"]]} onChange={(v) => setForm({ ...form, type: v })} />
        <SelectField label="Method" value={form.method} options={[["UPI", "UPI"], ["RAZORPAY", "Razorpay"], ["BMC", "Buy Me a Coffee"], ["BANK", "Bank Transfer"], ["OTHER", "Other"]]} onChange={(v) => setForm({ ...form, method: v })} />
        <Field label="Description"><input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" /></Field>
        {form.direction === "IN" && <SelectField label="Donor / source user" value={form.fromUserId} options={[["", "External / unlinked"], ...users.map((u) => [u.id, `${u.name}${u.telegramUser ? ` (@${u.telegramUser})` : ""}`])]} onChange={(v) => setForm({ ...form, fromUserId: v })} />}
      </div>
      <Field label="Attachments (one stored URL or file reference per line)" extra="mt-4"><textarea rows={3} value={form.attachments} onChange={(e) => setForm({ ...form, attachments: e.target.value })} className="input resize-y" placeholder="https://..." /></Field>
      <button disabled={saving || !form.amount || !form.description.trim()} className="mt-4 rounded-full bg-lime px-6 py-2.5 text-sm font-semibold text-bg-void disabled:opacity-40">{saving ? "Saving..." : editingId ? "Save changes" : "Log transaction"}</button>
    </form>;
  }

  const allVisibleSelected = transactions.length > 0 && transactions.every((tx) => selected.has(tx.id));
  return <div>
    <style>{`.input{width:100%;border:1px solid var(--border);border-radius:.5rem;background:var(--bg-deep);padding:.75rem 1rem;color:var(--text-primary);outline:none}.input:focus{border-color:rgba(190,242,100,.3)}.pill{border-radius:999px;background:rgba(255,255,255,.04);padding:.3rem .75rem;font-size:.75rem;font-weight:600;transition:background .15s}.pill:hover{background:rgba(255,255,255,.08)}`}</style>
    <ConfirmDialog open={reviewedEditConfirm} onClose={() => { setReviewedEditConfirm(false); setPendingReviewedSubmit(false); }} onConfirm={() => { setReviewedEditConfirm(false); if (pendingReviewedSubmit) void submitForm(true); }} title="Edit a reviewed transaction?" message="This can change historical balances. The before/after values will remain in the audit and Telegram logs." confirmLabel="Save reviewed edit" variant="default" loading={saving} />
    <ActionDialog open={Boolean(action)} action={action?.kind || "APPROVE"} count={action?.ids.length || 0} loading={actionLoading} onClose={() => setAction(null)} onConfirm={runAction} />

    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-extrabold">All <span className="font-display text-lime">Transactions</span></h1><p className="mt-1 text-xs text-text-tertiary">{total.toLocaleString()} matching ledger entries</p></div><div className="flex flex-wrap gap-2"><button onClick={() => window.open(`/api/transactions/export?${filterQuery}`, "_blank")} className="rounded-full border border-[var(--border)] px-4 py-2.5 font-mono text-[10px] uppercase text-text-secondary">Export filtered CSV</button><button onClick={() => { resetForm(); setShowCreate(true); }} className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-bg-void">Log transaction</button></div></div>
    {feedback && <div role="status" className={`mb-4 rounded-xl border p-4 text-sm ${feedback.tone === "success" ? "border-mint/20 bg-mint/8 text-mint" : "border-coral/20 bg-coral/8 text-coral"}`}>{feedback.text}</div>}
    {error && <div className="mb-4 rounded-xl border border-coral/20 bg-coral/8 p-4 text-sm text-coral">{error} <button className="underline" onClick={() => void load()}>Retry</button></div>}
    {showCreate && editor()}

    <section className="card mb-4 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Field label="Search" extra="sm:col-span-2 xl:col-span-2"><input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ID, description, donor or recorder" className="input" /></Field>
        <SelectField label="Status" value={filters.status} options={[["ALL", "All statuses"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]]} onChange={(v) => updateFilter("status", v)} />
        <SelectField label="Direction" value={filters.direction} options={[["ALL", "All directions"], ["IN", "Incoming"], ["OUT", "Outgoing"]]} onChange={(v) => updateFilter("direction", v)} />
        <SelectField label="Currency" value={filters.currency} options={[["ALL", "All currencies"], ["INR", "INR"], ["USD", "USD"]]} onChange={(v) => updateFilter("currency", v)} />
        <SelectField label="Lifecycle" value={filters.lifecycle} options={[["ACTIVE", "Active only"], ["VOIDED", "Voided only"], ["ALL", "Active + voided"]]} onChange={(v) => updateFilter("lifecycle", v)} />
        <SelectField label="Type" value={filters.type} options={[["ALL", "All types"], ["DONATION", "Donation"], ["EXPENSE", "Expense"], ["SUBSCRIPTION", "Subscription"], ["OTHER", "Other"]]} onChange={(v) => updateFilter("type", v)} />
        <SelectField label="Method" value={filters.method} options={[["ALL", "All methods"], ["UPI", "UPI"], ["RAZORPAY", "Razorpay"], ["BMC", "Buy Me a Coffee"], ["BANK", "Bank Transfer"], ["OTHER", "Other"]]} onChange={(v) => updateFilter("method", v)} />
        <Field label="Date from"><input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className="input" /></Field>
        <Field label="Date to"><input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className="input" /></Field>
        <Field label="Minimum amount"><input inputMode="decimal" value={filters.amountMin} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && updateFilter("amountMin", e.target.value)} className="input" /></Field>
        <Field label="Maximum amount"><input inputMode="decimal" value={filters.amountMax} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && updateFilter("amountMax", e.target.value)} className="input" /></Field>
        <SelectField label="Sort" value={filters.sort} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["amount_high", "Amount: high to low"], ["amount_low", "Amount: low to high"]]} onChange={(v) => updateFilter("sort", v)} />
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2"><button onClick={() => { setFilters(defaultFilters); setSearchInput(""); setSearch(""); setPage(1); }} className="text-xs text-text-tertiary underline">Reset filters</button><span className="text-xs text-text-tertiary">Filters and search apply to selection, export, and pagination.</span></div>
    </section>

    <div className="sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]/95 p-3 shadow-lg backdrop-blur">
      <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={allVisibleSelected} onChange={selectVisible} className="h-4 w-4 accent-[var(--lime)]" /> Select visible</label>
      <button disabled={selectingAll || total === 0} onClick={() => void selectAllFiltered()} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40">{selectingAll ? "Selecting..." : `Select all ${total.toLocaleString()} filtered`}</button>
      {selected.size > 0 && <><span className="text-xs font-semibold text-lime">{selected.size.toLocaleString()} selected</span><button onClick={() => setSelected(new Set())} className="text-xs text-text-tertiary underline">Clear</button><span className="grow" /><button onClick={() => setAction({ kind: "APPROVE", ids: [...selected] })} className="rounded-full bg-mint/10 px-3 py-1.5 text-xs font-semibold text-mint">Approve selected</button><button onClick={() => setAction({ kind: "REJECT", ids: [...selected] })} className="rounded-full bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral">Reject selected</button><button onClick={() => setAction({ kind: "VOID", ids: [...selected] })} className="rounded-full bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral">Void selected</button></>}
    </div>

    <div className="card overflow-hidden">
      {loading ? <div className="p-8 text-center text-sm text-text-tertiary">Loading transactions...</div> : transactions.length === 0 ? <div className="p-8 text-center text-sm text-text-secondary">No transactions match these filters.</div> : <div className="overflow-visible lg:overflow-x-auto"><table className="block w-full lg:table"><thead className="hidden lg:table-header-group"><tr className="border-b border-[var(--border)]"><th className="w-10 p-4" /><Th>Description</Th><Th right>Amount</Th><Th>Status</Th><Th>Date</Th><Th>Actions</Th></tr></thead><tbody className="block lg:table-row-group">
        {transactions.map((tx) => <Fragment key={tx.id}><tr className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-4 border-b border-[var(--border)] p-4 lg:table-row lg:p-0 ${tx.voidedAt ? "opacity-60" : ""}`}>
          <td className="row-span-4 p-0 lg:table-cell lg:p-4"><input aria-label={`Select ${tx.description}`} type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSelected(tx.id)} className="h-4 w-4 accent-[var(--lime)]" /></td>
          <td className="p-0 lg:table-cell lg:p-4"><div className="text-sm font-medium text-text-primary">{tx.description}</div><div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary"><span>{tx.type}</span><span>·</span><span>{tx.method}</span>{tx.fromUser && <><span>·</span><span>from {tx.fromUser.name}</span></>}{tx.attachments.length > 0 && <><span>·</span><span>📎 {tx.attachments.length}</span></>}</div>{tx.voidedAt && <div className="mt-2 rounded-lg bg-coral/8 p-2 text-[11px] text-coral">Voided by {tx.voidedBy?.name || "admin"}: {tx.voidReason}</div>}</td>
          <td className={`p-0 text-sm font-semibold lg:table-cell lg:p-4 lg:text-right ${tx.direction === "IN" ? "text-mint" : "text-coral"}`}><span className="mr-2 font-mono text-[8px] uppercase text-text-tertiary lg:hidden">Amount</span>{money(tx)} <span className="text-[9px] text-text-tertiary">{tx.currency}</span></td>
          <td className="p-0 lg:table-cell lg:p-4 lg:text-center"><span className={`status-tag ${tx.status === "APPROVED" ? "status-approved" : tx.status === "PENDING" ? "status-pending" : "status-rejected"}`}>{tx.status}</span>{tx.voidedAt && <span className="ml-1 rounded bg-coral/10 px-2 py-1 font-mono text-[9px] text-coral">VOIDED</span>}</td>
          <td className="p-0 text-xs text-text-secondary lg:table-cell lg:p-4 lg:text-right">{formatDate(tx.date)}</td>
          <td className="col-span-2 p-0 lg:table-cell lg:p-4"><div className="flex flex-wrap gap-1 lg:justify-center">{!tx.voidedAt && tx.status === "PENDING" && <><button onClick={() => setAction({ kind: "APPROVE", ids: [tx.id] })} className="pill text-mint">Approve</button><button onClick={() => setAction({ kind: "REJECT", ids: [tx.id] })} className="pill text-coral">Reject</button></>}<button disabled={Boolean(tx.voidedAt)} onClick={() => startEdit(tx)} className="pill text-violet disabled:opacity-30">{editingId === tx.id ? "Editing" : "Edit"}</button>{!tx.voidedAt && <button onClick={() => setAction({ kind: "VOID", ids: [tx.id] })} className="pill text-coral">Void</button>}</div></td>
        </tr>{editingId === tx.id && <tr className="block border-b border-[var(--border)] lg:table-row"><td colSpan={6} className="block p-0 lg:table-cell">{editor()}</td></tr>}</Fragment>)}
      </tbody></table></div>}
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-text-tertiary">Page {page} of {totalPages} · {total.toLocaleString()} results</div><div className="flex items-center gap-2"><select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="rounded-lg border border-[var(--border)] bg-bg-deep px-2 py-2 text-xs"><option value="10">10/page</option><option value="25">25/page</option><option value="50">50/page</option><option value="100">100/page</option></select><button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-30">Previous</button><button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-30">Next</button></div></div>
    <PageTour pageKey="admin-transactions" />
  </div>;
}

function Field({ label, children, extra = "" }: { label: string; children: React.ReactNode; extra?: string }) { return <div className={extra}><label className="mb-2 block font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">{label}</label>{children}</div>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <Field label={label}><Dropdown value={value} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} onChange={onChange} /></Field>; }
function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) { return <th className={`p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary ${right ? "text-right" : "text-left"}`}>{children}</th>; }
