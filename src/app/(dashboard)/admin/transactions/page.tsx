"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import RazorpayMark from "@/components/RazorpayMark";
import ConfirmDialog from "@/components/ConfirmDialog";
import Dropdown from "@/components/Dropdown";
import PageTour from "@/components/PageTour";
import TransactionAttachmentField from "@/components/TransactionAttachmentField";
import TransactionsNav from "@/components/TransactionsNav";
import Link from "next/link";
import TransactionAttribution from "@/components/TransactionAttribution";
import ShareButton from "@/components/ShareButton";
import { CUSTOM_REPEAT_UNITS, SERVICE_FREQUENCY_OPTIONS } from "@/lib/service-billing";
import { linkedServiceEditFields, type EditableLinkedService, type ServiceEditColumn } from "@/lib/transaction-service-edit";

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
  paymentMethodDetail?: string | null;
  direction: string;
  type: string;
  description: string;
  status: string;
  providerVerified?: boolean;
  providerState?: string | null;
  date: string;
  attachments: string[];
  reviewNote?: string | null;
  fromUser?: Person | null;
  createdBy?: Person | null;
  reviewedBy?: Person | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  voidedBy?: Person | null;
  bmcWebhookEvents?: Array<{
    supporterEmail: string | null;
    supporterId: string | null;
    attributionStatus: string;
  }>;
  linkedService?: ServiceOption | null;
}

interface UserOption { id: string; name: string; telegramUser: string | null; photoUrl?: string | null }
type ColumnDef = ServiceEditColumn;
interface CredentialDraft { id?: string; platform: string; label: string; value: string; expiresAt: string }
type ServiceOption = EditableLinkedService;
type ActionKind = "APPROVE" | "REJECT" | "VOID";

const defaultFilters = {
  status: "ALL", direction: "ALL", currency: "ALL", type: "ALL", method: "ALL",
  lifecycle: "ACTIVE", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", sort: "newest",
};

function emptyTransactionForm() {
  return {
    amount: "", currency: "INR", method: "OTHER", direction: "OUT", type: "EXPENSE", description: "", date: "", fromUserId: "",
    serviceAction: "NONE", serviceId: "", serviceName: "", serviceCategory: "", serviceFrequency: "MONTHLY", serviceRenewal: "",
    serviceCustomRepeatEvery: "1", serviceCustomRepeatUnit: "MONTH", servicePlanUrl: "", serviceAutoRenew: false,
    serviceColumns: [] as ColumnDef[], serviceMetadata: {} as Record<string, string>, credentials: [] as CredentialDraft[], attachments: [] as string[],
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase(),
  };
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

function ProviderDetailsDialog({ open, loading, method, details, error, onClose }: {
  open: boolean;
  loading: boolean;
  method: string;
  details: unknown;
  error: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Encrypted provider details</h2>
            <p className="mt-1 text-xs text-text-tertiary">{method} · reveal audited · never returned to donors</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-[var(--bg-hover)]">Close</button>
        </div>
        {loading ? <p className="mt-5 text-sm text-text-secondary">Decrypting…</p>
          : error ? <p className="mt-5 rounded-xl border border-coral/20 bg-coral/8 p-3 text-sm text-coral">{error}</p>
            : <pre className="mt-5 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-bg-deep p-4 text-xs leading-relaxed text-text-secondary">{JSON.stringify(details, null, 2)}</pre>}
      </div>
    </div>,
    document.body,
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
  const [targetTransactionId, setTargetTransactionId] = useState("");
  const openedTargetRef = useRef("");
  const [filters, setFilters] = useState(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [receiptTargetId, setReceiptTargetId] = useState<string | null>(null);
  const [newReceiptFiles, setNewReceiptFiles] = useState<string[]>([]);
  const [savingReceipts, setSavingReceipts] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [action, setAction] = useState<{ kind: ActionKind; ids: string[] } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewedEditConfirm, setReviewedEditConfirm] = useState(false);
  const [pendingReviewedSubmit, setPendingReviewedSubmit] = useState(false);
  const [providerDetails, setProviderDetails] = useState<{ open: boolean; loading: boolean; method: string; details: unknown; error: string }>({ open: false, loading: false, method: "", details: null, error: "" });
  const [form, setForm] = useState(emptyTransactionForm);

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); setSelected(new Set()); }, 350); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setTargetTransactionId(params.get("transactionId")?.trim() || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: filters.sort, lifecycle: filters.lifecycle });
    if (targetTransactionId) params.set("transactionId", targetTransactionId);
    if (search) params.set("search", search);
    for (const key of ["status", "direction", "currency", "type", "method"] as const) if (filters[key] !== "ALL") params.set(key, filters[key]);
    for (const key of ["dateFrom", "dateTo", "amountMin", "amountMax"] as const) if (filters[key]) params.set(key, filters[key]);
    return params.toString();
  }, [filters, limit, page, search, targetTransactionId]);

  const filterQuery = useMemo(() => { const params = new URLSearchParams(queryString); params.delete("page"); params.delete("limit"); return params.toString(); }, [queryString]);
  const activeFilterCount = useMemo(() => (Object.keys(defaultFilters) as Array<keyof typeof defaultFilters>)
    .filter((key) => filters[key] !== defaultFilters[key]).length, [filters]);

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
  useEffect(() => { fetch("/api/services").then((r) => r.json()).then((d) => setServices(d.services || [])).catch(() => {}); }, []);

  function updateFilter(key: keyof typeof defaultFilters, value: string) { setFilters((current) => ({ ...current, [key]: value })); setPage(1); setSelected(new Set()); }
  function resetForm() {
    setForm(emptyTransactionForm());
    setUploadingAttachments(false); setEditingId(null);
    if (targetTransactionId) {
      setTargetTransactionId("");
      openedTargetRef.current = "";
      const url = new URL(window.location.href);
      url.searchParams.delete("transactionId");
      url.searchParams.delete("reconcile");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
  const startEdit = useCallback((tx: Transaction) => {
    if (tx.voidedAt) return;
    const service = tx.linkedService;
    setEditingId(tx.id);
    setForm({
      ...emptyTransactionForm(),
      amount: String(Number(tx.amount)), currency: tx.currency, method: tx.method, direction: tx.direction, type: tx.type, description: tx.description,
      date: tx.date.slice(0, 10), fromUserId: tx.fromUser?.id || "", serviceAction: service ? "LINK" : "NONE",
      ...(service ? linkedServiceEditFields(service) : {}),
      attachments: [...tx.attachments],
    });
    setTimeout(() => document.getElementById(`editor-${tx.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!targetTransactionId || openedTargetRef.current === targetTransactionId) return;
      const target = transactions.find((transaction) => transaction.id === targetTransactionId);
      if (!target) return;
      openedTargetRef.current = targetTransactionId;
      startEdit(target);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [startEdit, targetTransactionId, transactions]);

  async function revealProviderDetails(tx: Transaction) {
    setProviderDetails({ open: true, loading: true, method: tx.method, details: null, error: "" });
    try {
      const response = await fetch(`/api/transactions/${tx.id}/provider-details`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reveal provider details");
      setProviderDetails({ open: true, loading: false, method: data.method, details: data.details, error: "" });
    } catch (error) {
      setProviderDetails({ open: true, loading: false, method: tx.method, details: null, error: error instanceof Error ? error.message : "Could not reveal provider details" });
    }
  }

  async function submitForm(confirmReviewedEdit = false) {
    if (!editingId) return;
    setSaving(true); setFeedback(null);
    try {
      const editing = transactions.find((tx) => tx.id === editingId);
      if (editing && editing.status !== "PENDING" && !confirmReviewedEdit) { setPendingReviewedSubmit(true); setReviewedEditConfirm(true); return; }
      const serviceDetails = {
        name: form.serviceName, category: form.serviceCategory, frequency: form.serviceFrequency, nextRenewal: form.serviceRenewal,
        customRepeatEvery: form.serviceCustomRepeatEvery, customRepeatUnit: form.serviceCustomRepeatUnit,
        planUrl: form.servicePlanUrl, autoRenew: form.serviceAutoRenew, columns: form.serviceColumns,
        entries: form.serviceColumns.length ? [form.serviceMetadata] : [],
      };
      const payload = { ...form, fromUserId: form.direction === "IN" ? form.fromUserId || null : null, serviceId: form.serviceAction === "LINK" ? form.serviceId || null : null, createService: form.serviceAction === "CREATE" ? serviceDetails : undefined, updateService: form.serviceAction === "LINK" ? serviceDetails : undefined, credentials: ["LINK", "CREATE"].includes(form.serviceAction) ? form.credentials : undefined, confirmReviewedEdit };
      const response = await fetch(`/api/transactions/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (response.status === 409 && editing && editing.status !== "PENDING" && !confirmReviewedEdit) { setPendingReviewedSubmit(true); setReviewedEditConfirm(true); return; }
      if (!response.ok) throw new Error(data.error || "Could not save transaction");
      const archiveFailures = (data.attachmentArchive || []).filter((result: { archived: boolean }) => !result.archived);
      setFeedback(archiveFailures.length > 0
        ? { tone: "error", text: `Transaction saved, but ${archiveFailures.length} attachment${archiveFailures.length === 1 ? "" : "s"} could not be copied to Telegram. Saving the transaction again will retry.` }
        : { tone: "success", text: "Transaction updated, audited, and attachments archived." });
      resetForm(); await load();
    } catch (e) { setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Could not save transaction" }); }
    finally { setSaving(false); }
  }

  async function addReceipts(transactionId: string) {
    if (!newReceiptFiles.length) return;
    setSavingReceipts(true); setFeedback(null);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachments: newReceiptFiles }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not add receipt");
      setFeedback({ tone: "success", text: "Receipt added and archived." });
      setReceiptTargetId(null); setNewReceiptFiles([]); await load();
    } catch (error) { setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Could not add receipt" }); }
    finally { setSavingReceipts(false); }
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
      setSelected(new Set()); setSelectionMode(false); setAction(null); await load();
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

  function selectLinkedService(serviceId: string) {
    const service = services.find((item) => item.id === serviceId);
    if (!service) { setForm({ ...form, serviceId }); return; }
    setForm({
      ...form,
      ...linkedServiceEditFields(service),
    });
  }

  function editor() {
    const editing = transactions.find((tx) => tx.id === editingId);
    const reconcilingBmc = editing?.method === "BMC" && !editing.fromUser;
    return <form id={editingId ? `editor-${editingId}` : undefined} className="border-t border-violet/20 bg-violet/[0.04] p-4 sm:p-6" onSubmit={(e) => { e.preventDefault(); void submitForm(); }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">{reconcilingBmc ? "Assign BMC donor" : editingId ? "Edit transaction" : "New transaction"}</h2>{reconcilingBmc && <p className="mt-1 text-xs text-coral">Choose the donor in “Donor / source user”, then save the assignment.</p>}{editing && editing.status !== "PENDING" && <p className="mt-1 text-xs text-amber">Reviewed transaction — saving material changes requires confirmation.</p>}</div><button type="button" onClick={resetForm} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[10px] text-text-secondary">Cancel</button></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Amount"><input required inputMode="decimal" value={form.amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setForm({ ...form, amount: e.target.value })} className="input" /></Field>
        <SelectField label="Currency" value={form.currency} options={[["INR", "INR (₹)"], ["USD", "USD ($)"]]} onChange={(v) => setForm({ ...form, currency: v })} />
        <SelectField label="Direction" value={form.direction} options={[["IN", "Income (IN)"], ["OUT", "Expense (OUT)"]]} onChange={(v) => setForm({ ...form, direction: v, fromUserId: v === "OUT" ? "" : form.fromUserId })} />
        <SelectField label="Type" value={form.type} options={[["DONATION", "Donation"], ["EXPENSE", "Expense"], ["SUBSCRIPTION", "Subscription"], ["OTHER", "Other"]]} onChange={(v) => setForm({ ...form, type: v })} />
        {editing && (editing.method === "RAZORPAY" || editing.method === "BMC") ? <Field label="Payment source"><div className="input flex items-center text-sm text-text-secondary">{editing.method === "RAZORPAY" ? "Razorpay · provider controlled" : "Buy Me a Coffee · provider controlled"}</div></Field> : <SelectField label="Payment source" value={form.method} options={[["OTHER", "Admin noted / unknown"], ["BANK", "Bank Transfer"], ["UPI", "Confirmed direct UPI"]]} onChange={(v) => setForm({ ...form, method: v })} />}
        <Field label="Description"><input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" /></Field>
        {form.direction === "IN" && <Field label="Donor / source user"><Dropdown value={form.fromUserId} options={[{ value: "", label: "External / unlinked" }, ...users.map((u) => ({ value: u.id, label: `${u.name}${u.telegramUser ? ` (@${u.telegramUser})` : ""}`, avatar: u.photoUrl ?? null }))]} onChange={(v) => setForm({ ...form, fromUserId: v })} /></Field>}
        {form.direction === "OUT" && form.type === "SUBSCRIPTION" && <SelectField label="Service record" value={form.serviceAction} options={[["NONE", "No service"], ["LINK", "Link existing service"], ["CREATE", "Create service from transaction"]]} onChange={(v) => setForm({ ...form, serviceAction: v, serviceId: v === "LINK" ? form.serviceId : "" })} />}
        {form.direction === "OUT" && form.type === "SUBSCRIPTION" && form.serviceAction === "LINK" && <SelectField label="Existing service" value={form.serviceId} options={[["", "Choose service"], ...services.map((service) => [service.id, `${service.name} · ${service.category}`])]} onChange={selectLinkedService} />}
      </div>
      {form.direction === "OUT" && form.type === "SUBSCRIPTION" && (form.serviceAction === "CREATE" || (form.serviceAction === "LINK" && form.serviceId !== "")) ? <>
        <section className="mt-4 space-y-4 rounded-xl border border-lime/15 bg-lime/[.03] p-4">
          <div><h3 className="text-sm font-bold text-text-primary">Service details</h3><p className="mt-1 text-xs text-text-tertiary">The same service, billing, advanced and secure-access fields shown during the first submission.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Service name"><input required value={form.serviceName} onChange={(e) => setForm({ ...form, serviceName: e.target.value })} className="input" /></Field>
            <Field label="Category"><input required value={form.serviceCategory} onChange={(e) => setForm({ ...form, serviceCategory: e.target.value })} className="input" /></Field>
            <SelectField label="Billing frequency" value={form.serviceFrequency} options={SERVICE_FREQUENCY_OPTIONS.map((option) => [option.value, option.label])} onChange={(v) => setForm({ ...form, serviceFrequency: v })} />
            <Field label="Next renewal"><input required type="date" value={form.serviceRenewal} onChange={(e) => setForm({ ...form, serviceRenewal: e.target.value })} className="input" /></Field>
            {form.serviceFrequency === "CUSTOM" && <>
              <Field label="Repeat every"><input required min="1" step="1" type="number" value={form.serviceCustomRepeatEvery} onChange={(e) => setForm({ ...form, serviceCustomRepeatEvery: e.target.value })} className="input" /></Field>
              <SelectField label="Custom unit" value={form.serviceCustomRepeatUnit} options={CUSTOM_REPEAT_UNITS.map((unit) => [unit, `${unit.charAt(0)}${unit.slice(1).toLowerCase()}`])} onChange={(v) => setForm({ ...form, serviceCustomRepeatUnit: v })} />
            </>}
            <Field label="Plan / dashboard URL" extra="sm:col-span-2"><input type="url" value={form.servicePlanUrl} onChange={(e) => setForm({ ...form, servicePlanUrl: e.target.value })} placeholder="https://…" className="input" /></Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-4"><input type="checkbox" checked={form.serviceAutoRenew} onChange={(event) => setForm({ ...form, serviceAutoRenew: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--lime)]" /><span><span className="block text-sm font-semibold">Request renewal approval automatically</span><span className="mt-1 block text-xs text-text-tertiary">Creates a pending transaction each cycle; funds move only after approval.</span></span></label>
          {form.serviceColumns.length > 0 && <details open className="rounded-xl border border-[var(--border)] bg-bg-deep p-4"><summary className="cursor-pointer text-sm font-semibold text-text-secondary">Advanced service fields</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{form.serviceColumns.map((column) => <Field key={column.key} label={column.label}><input value={form.serviceMetadata[column.key] || ""} onChange={(event) => setForm({ ...form, serviceMetadata: { ...form.serviceMetadata, [column.key]: event.target.value } })} className="input" /></Field>)}</div></details>}
        </section>
        <section className="mt-4 space-y-3 rounded-xl border border-violet/20 bg-violet/[.025] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-text-primary">Secure access</h3><p className="mt-1 text-xs text-text-tertiary">Existing secrets stay encrypted. Leave a saved secret blank to keep it unchanged.</p></div><button type="button" onClick={() => setForm({ ...form, credentials: [...form.credentials, { platform: form.serviceName, label: "", value: "", expiresAt: "" }] })} className="rounded-full border border-violet/25 px-4 py-2 text-xs font-semibold text-violet">Add credential</button></div>
          {form.credentials.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-text-tertiary">No secure-access fields are linked yet.</p>}
          {form.credentials.map((credential, index) => <div key={credential.id || `new-${index}`} className="grid gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_auto]">
            <input value={credential.label} onChange={(event) => setForm({ ...form, credentials: form.credentials.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} placeholder="Credential label (Host/IP, Username, SSH key…)" className="input" />
            <input type="password" autoComplete="new-password" value={credential.value} onChange={(event) => setForm({ ...form, credentials: form.credentials.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} placeholder={credential.id ? "Saved securely — enter replacement only" : "Secret value"} className="input" />
            <input type="date" value={credential.expiresAt} onChange={(event) => setForm({ ...form, credentials: form.credentials.map((item, itemIndex) => itemIndex === index ? { ...item, expiresAt: event.target.value } : item) })} className="input" />
            {credential.id ? <span className="self-center rounded-full bg-mint/8 px-3 py-2 text-center text-[10px] font-semibold text-mint">Saved</span> : <button type="button" onClick={() => setForm({ ...form, credentials: form.credentials.filter((_, itemIndex) => itemIndex !== index) })} className="rounded-xl border border-coral/20 px-3 py-2 text-xs font-semibold text-coral">Remove</button>}
          </div>)}
        </section>
      </> : null}
      <TransactionAttachmentField value={form.attachments} onChange={(attachments) => setForm({ ...form, attachments })} onUploadingChange={setUploadingAttachments} />
      <button disabled={saving || uploadingAttachments || !form.amount || !form.description.trim() || Boolean(reconcilingBmc && !form.fromUserId)} className="mt-4 rounded-full bg-lime px-6 py-2.5 text-sm font-semibold text-bg-void disabled:opacity-40">{uploadingAttachments ? "Uploading attachments..." : saving ? "Saving..." : reconcilingBmc ? "Assign donor" : editingId ? "Save changes" : "Log transaction"}</button>
    </form>;
  }

  const allVisibleSelected = transactions.length > 0 && transactions.every((tx) => selected.has(tx.id));
  return <div>
    <style>{`.input{width:100%;border:1px solid var(--border);border-radius:.5rem;background:var(--bg-deep);padding:.75rem 1rem;color:var(--text-primary);outline:none}.input:focus{border-color:rgba(190,242,100,.3)}.pill{min-width:0;min-height:2rem;white-space:normal;border-radius:999px;background:rgba(255,255,255,.04);padding:.3rem .55rem;font-size:.7rem;font-weight:600;line-height:1.15;transition:background .15s}.pill:hover{background:rgba(255,255,255,.08)}`}</style>
    <ConfirmDialog open={reviewedEditConfirm} onClose={() => { setReviewedEditConfirm(false); setPendingReviewedSubmit(false); }} onConfirm={() => { setReviewedEditConfirm(false); if (pendingReviewedSubmit) void submitForm(true); }} title="Edit a reviewed transaction?" message="This can change historical balances. The before/after values will remain in the audit and Telegram logs." confirmLabel="Save reviewed edit" variant="default" loading={saving} />
    <ActionDialog open={Boolean(action)} action={action?.kind || "APPROVE"} count={action?.ids.length || 0} loading={actionLoading} onClose={() => setAction(null)} onConfirm={runAction} />

    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-extrabold">All <span className="font-display text-lime">Transactions</span></h1><p className="mt-1 text-xs text-text-tertiary">{total.toLocaleString()} matching ledger entries</p></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><button onClick={() => window.open(`/api/transactions/export?${filterQuery}`, "_blank")} className="rounded-full border border-[var(--border)] px-4 py-2.5 font-mono text-[10px] uppercase text-text-secondary">Export filtered CSV</button><Link data-tour="log-transaction" href="/admin/transactions/new" className="rounded-full bg-lime px-5 py-2.5 text-center text-sm font-semibold text-bg-void">Record transaction</Link></div></div>
    <TransactionsNav />
    {feedback && <div role="status" className={`mb-4 rounded-xl border p-4 text-sm ${feedback.tone === "success" ? "border-mint/20 bg-mint/8 text-mint" : "border-coral/20 bg-coral/8 text-coral"}`}>{feedback.text}</div>}
    {error && <div className="mb-4 rounded-xl border border-coral/20 bg-coral/8 p-4 text-sm text-coral">{error} <button className="underline" onClick={() => void load()}>Retry</button></div>}
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Quick provider view">
      <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">Quick view</span>
      <button
        type="button"
        aria-pressed={filters.method === "ALL"}
        onClick={() => updateFilter("method", "ALL")}
        className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${filters.method === "ALL" ? "border-lime/35 bg-lime/10 text-lime" : "border-[var(--border)] text-text-secondary hover:bg-[var(--bg-hover)]"}`}
      >
        All providers
      </button>
      <button
        type="button"
        aria-pressed={filters.method === "RAZORPAY"}
        onClick={() => updateFilter("method", "RAZORPAY")}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${filters.method === "RAZORPAY" ? "border-sky-400/40 bg-sky-400/10 text-sky-300" : "border-[var(--border)] text-text-secondary hover:bg-[var(--bg-hover)]"}`}
      >
        <RazorpayMark size="sm" />
        Only
      </button>
      <button
        type="button"
        aria-pressed={filters.method === "BMC"}
        onClick={() => updateFilter("method", "BMC")}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${filters.method === "BMC" ? "border-amber/40 bg-amber/10 text-amber" : "border-[var(--border)] text-text-secondary hover:bg-[var(--bg-hover)]"}`}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white p-1 shadow-sm">
          <Image src="/Payment Apps Icons/bmc-logo-no-background.png" alt="" width={14} height={20} className="h-5 w-auto object-contain" />
        </span>
        Only
      </button>
    </div>

    <section className="card mb-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search transactions</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search ID, description, donor or recorder" className="input !pl-11" />
        </label>
        <button type="button" aria-expanded={filtersOpen} aria-controls="transaction-filters" onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-[var(--bg-hover)]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          Filters
          {activeFilterCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lime px-1.5 text-[9px] font-bold text-bg-void">{activeFilterCount}</span>}
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`}><path d="m5 7.5 5 5 5-5" /></svg>
        </button>
      </div>
      {filtersOpen && (
        <div id="transaction-filters" className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
          <div className="mt-4 flex flex-wrap justify-between gap-2"><button onClick={() => { setFilters(defaultFilters); setPage(1); }} className="text-xs text-text-tertiary underline">Reset filters</button><span className="text-xs text-text-tertiary">Filters and search apply to selection, export, and pagination.</span></div>
        </div>
      )}
    </section>

    <div className={`mb-3 flex flex-wrap items-center gap-2 ${selectionMode ? "sticky top-2 z-30 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]/95 p-3 shadow-lg backdrop-blur" : "justify-end"}`}>
      {!selectionMode ? (
        <button type="button" onClick={() => setSelectionMode(true)} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-[var(--bg-hover)]">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><path d="m12.5 14.5 1.5 1.5 3-3" /></svg>
          Select multiple
        </button>
      ) : <>
        <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={allVisibleSelected} onChange={selectVisible} className="h-4 w-4 accent-[var(--lime)]" /> Select visible</label>
        <button disabled={selectingAll || total === 0} onClick={() => void selectAllFiltered()} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40">{selectingAll ? "Selecting..." : `Select all ${total.toLocaleString()} filtered`}</button>
        <button onClick={() => { setSelected(new Set()); setSelectionMode(false); }} className="text-xs text-text-tertiary underline">Cancel selection</button>
        {selected.size > 0 && <><span className="text-xs font-semibold text-lime">{selected.size.toLocaleString()} selected</span><button onClick={() => setSelected(new Set())} className="text-xs text-text-tertiary underline">Clear</button><span className="grow" /><button onClick={() => setAction({ kind: "APPROVE", ids: [...selected] })} className="rounded-full bg-mint/10 px-3 py-1.5 text-xs font-semibold text-mint">Approve selected</button><button onClick={() => setAction({ kind: "REJECT", ids: [...selected] })} className="rounded-full bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral">Reject selected</button><button onClick={() => setAction({ kind: "VOID", ids: [...selected] })} className="rounded-full bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral">Void selected</button></>}
      </>}
    </div>

    <div className="card overflow-hidden">
      {loading ? <div className="p-8 text-center text-sm text-text-tertiary">Loading transactions...</div> : transactions.length === 0 ? <div className="p-8 text-center text-sm text-text-secondary">No transactions match these filters.</div> : <div role="table" className="w-full">
        <div role="row" className={`hidden border-b border-[var(--border)] lg:grid ${selectionMode ? "lg:grid-cols-[2rem_minmax(0,1fr)_6.5rem_7rem_7.5rem_12rem]" : "lg:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7.5rem_12rem]"}`}>{selectionMode && <div role="columnheader" />}<GridHeader>Description</GridHeader><GridHeader right>Amount</GridHeader><GridHeader right>Status</GridHeader><GridHeader right>Date</GridHeader><GridHeader right>Actions</GridHeader></div>
        <div role="rowgroup">
        {transactions.map((tx) => { const formattedDate = formatDate(tx.date); return <Fragment key={tx.id}><div role="row" data-share-target={`transaction:${tx.id}`} className={`grid ${selectionMode ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"} gap-x-3 gap-y-3 border-b border-[var(--border)] p-4 lg:min-h-[136px] lg:items-center lg:gap-0 lg:p-0 ${selectionMode ? "lg:grid-cols-[2rem_minmax(0,1fr)_6.5rem_7rem_7.5rem_12rem]" : "lg:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7.5rem_12rem]"} ${tx.voidedAt ? "opacity-60" : ""}`}>
          {selectionMode && <div role="cell" className="row-span-5 flex items-start pt-1 lg:row-span-1 lg:items-center lg:justify-center lg:p-2"><input aria-label={`Select ${tx.description}`} type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSelected(tx.id)} className="h-4 w-4 accent-[var(--lime)]" /></div>}
          <div role="cell" className="min-w-0 lg:px-4 lg:py-5">
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1 text-sm font-medium text-text-primary lg:line-clamp-2">{tx.description}</div>
              {(tx.method === "BMC" || tx.method === "RAZORPAY") && (
                <button
                  type="button"
                  onClick={() => void revealProviderDetails(tx)}
                  title={`View encrypted ${tx.method === "BMC" ? "Buy Me a Coffee" : "Razorpay"} provider details`}
                  aria-label={`View encrypted ${tx.method === "BMC" ? "Buy Me a Coffee" : "Razorpay"} provider details`}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition-colors ${tx.method === "BMC" ? "border-amber/25 bg-amber/8 text-amber hover:bg-amber/15" : "border-sky-400/25 bg-sky-400/8 text-sky-300 hover:bg-sky-400/15"}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M2.5 10s2.7-4 7.5-4 7.5 4 7.5 4-2.7 4-7.5 4-7.5-4-7.5-4Z" /><circle cx="10" cy="10" r="1.8" /></svg>
                </button>
              )}
            </div>
            <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5 text-[10px] text-text-tertiary">
              <span>{tx.type}</span>
              {(tx.method === "BMC" || tx.method === "RAZORPAY") && <span className={`rounded-full px-2 py-1 font-mono text-[8px] font-bold uppercase ${tx.providerVerified === false ? "bg-coral/10 text-coral" : "bg-mint/10 text-mint"}`}>{tx.providerVerified === false ? "Provider unverified" : "Provider verified"}</span>}
              {tx.linkedService && <><span>·</span><a href={`/admin/services/${tx.linkedService.id}`} className="text-lime hover:underline">Service: {tx.linkedService.name}</a></>}
              {tx.method === "BMC" && !tx.fromUser && <span className="rounded-full bg-coral/10 px-2 py-1 font-mono text-[8px] font-bold uppercase text-coral">Unmatched · assign donor</span>}
              {tx.method === "BMC" && !tx.fromUser && tx.bmcWebhookEvents?.[0]?.supporterEmail && <><span>·</span><span title="BMC supporter email" className="text-text-secondary">{tx.bmcWebhookEvents[0].supporterEmail}</span></>}
              {tx.attachments.length > 0 && <><span>·</span><span>📎 {tx.attachments.length} receipt{tx.attachments.length === 1 ? "" : "s"}</span></>}
            </div>
            <div className="mt-2.5">
              <TransactionAttribution fromUser={tx.fromUser} createdBy={tx.createdBy} method={tx.method} detail={tx.paymentMethodDetail} size={28} />
            </div>
            {tx.attachments.length > 0 && <div className="mt-2 flex max-w-full flex-wrap gap-1.5">{tx.attachments.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-full border border-violet/20 bg-violet/8 px-2.5 py-1 text-[10px] text-violet">{decodeURIComponent(url.split("/").pop() || "Receipt")}</a>)}</div>}
            {tx.voidedAt && <div className="mt-2 rounded-lg bg-coral/8 p-2 text-[11px] text-coral">Voided by {tx.voidedBy?.name || "admin"}: {tx.voidReason}</div>}
          </div>
          <div role="cell" className={`flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2 text-sm font-semibold lg:block lg:rounded-none lg:bg-transparent lg:p-4 lg:text-right lg:whitespace-nowrap ${tx.direction === "IN" ? "text-mint" : "text-coral"}`}><span className="font-mono text-[8px] uppercase text-text-tertiary lg:hidden">Amount</span><span>{money(tx)} <span className="text-[9px] text-text-tertiary">{tx.currency}</span></span></div>
          <div role="cell" className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2 lg:block lg:rounded-none lg:bg-transparent lg:p-4 lg:text-right lg:whitespace-nowrap"><span className="font-mono text-[8px] uppercase text-text-tertiary lg:hidden">Status</span><span><span className={`status-tag ${tx.status === "APPROVED" ? "status-approved" : tx.status === "PENDING" ? "status-pending" : "status-rejected"}`}>{tx.status}</span>{tx.voidedAt && <span className="ml-1 rounded bg-coral/10 px-2 py-1 font-mono text-[9px] text-coral">VOIDED</span>}</span></div>
          <div role="cell" className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2 text-xs text-text-secondary lg:block lg:rounded-none lg:bg-transparent lg:p-3 lg:text-right"><span className="font-mono text-[8px] uppercase text-text-tertiary lg:hidden">Date</span><span className="text-right"><span className="block whitespace-nowrap">{formattedDate.day}</span><span className="mt-0.5 block whitespace-nowrap text-[10px] text-text-tertiary">{formattedDate.time}</span></span></div>
          <div role="cell" className={`${selectionMode ? "col-span-2 lg:col-span-1" : ""} min-w-0 lg:p-3`}><span className="mb-2 block font-mono text-[8px] uppercase text-text-tertiary lg:hidden">Actions</span><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-2 lg:gap-1">{!tx.voidedAt && tx.status === "PENDING" && <><button onClick={() => setAction({ kind: "APPROVE", ids: [tx.id] })} className="pill text-mint">Approve</button><button onClick={() => setAction({ kind: "REJECT", ids: [tx.id] })} className="pill text-coral">Reject</button></>}<button disabled={Boolean(tx.voidedAt)} onClick={() => startEdit(tx)} className="pill text-violet disabled:opacity-30">{editingId === tx.id ? "Editing" : tx.method === "BMC" && !tx.fromUser ? "Reconcile" : "Edit"}</button><button disabled={Boolean(tx.voidedAt)} onClick={() => { setReceiptTargetId(receiptTargetId === tx.id ? null : tx.id); setNewReceiptFiles([]); }} className="pill text-violet disabled:opacity-30">{receiptTargetId === tx.id ? "Close receipts" : tx.attachments.length ? "Add receipt" : "Upload receipt"}</button>{!tx.voidedAt && <button onClick={() => setAction({ kind: "VOID", ids: [tx.id] })} className="pill text-coral">Void</button>}<ShareButton entityType="transaction" entityId={tx.id} label="Share" className="py-1" /></div></div>
        </div>{receiptTargetId === tx.id && <div className="border-b border-[var(--border)] bg-violet/[.025] p-4 sm:p-6"><div className="mb-2"><h3 className="text-sm font-bold">Add receipt or invoice</h3><p className="mt-1 text-xs text-text-tertiary">Add missing documentation without editing the financial record.</p></div><TransactionAttachmentField value={newReceiptFiles} onChange={setNewReceiptFiles} onUploadingChange={setUploadingAttachments} /><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setReceiptTargetId(null); setNewReceiptFiles([]); }} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-text-secondary">Cancel</button><button type="button" disabled={savingReceipts || uploadingAttachments || !newReceiptFiles.length} onClick={() => void addReceipts(tx.id)} className="rounded-full bg-lime px-5 py-2 text-sm font-semibold text-bg-void disabled:opacity-40">{savingReceipts ? "Saving…" : "Attach receipt"}</button></div></div>}{editingId === tx.id && <div className="border-b border-[var(--border)]">{editor()}</div>}</Fragment>; })}
      </div></div>}
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-text-tertiary">Page {page} of {totalPages} · {total.toLocaleString()} results</div><div className="flex items-center gap-2"><select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="rounded-lg border border-[var(--border)] bg-bg-deep px-2 py-2 text-xs"><option value="10">10/page</option><option value="25">25/page</option><option value="50">50/page</option><option value="100">100/page</option></select><button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-30">Previous</button><button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-30">Next</button></div></div>
    <ProviderDetailsDialog
      open={providerDetails.open}
      loading={providerDetails.loading}
      method={providerDetails.method}
      details={providerDetails.details}
      error={providerDetails.error}
      onClose={() => setProviderDetails((current) => ({ ...current, open: false }))}
    />
    <PageTour pageKey="admin-transactions" />
  </div>;
}

function Field({ label, children, extra = "" }: { label: string; children: React.ReactNode; extra?: string }) { return <div className={extra}><label className="mb-2 block font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">{label}</label>{children}</div>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <Field label={label}><Dropdown value={value} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} onChange={onChange} /></Field>; }
function GridHeader({ children, right = false }: { children: React.ReactNode; right?: boolean }) { return <div role="columnheader" className={`p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary ${right ? "text-right" : "text-left"}`}>{children}</div>; }
