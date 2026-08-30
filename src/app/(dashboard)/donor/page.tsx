"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Dropdown from "@/components/Dropdown";
import FormExample from "@/components/FormExample";
import RazorpayDonationCard from "@/components/RazorpayDonationCard";
import BmcSupportCard from "@/components/BmcSupportCard";
import RazorpayAccessBanner from "@/components/RazorpayAccessBanner";
import PaymentMethodBadge from "@/components/PaymentMethodBadge";
import CurrencyToggle from "@/components/CurrencyToggle";
import AttachmentViewer, { attachmentName } from "@/components/AttachmentViewer";
import ConfirmDialog from "@/components/ConfirmDialog";
import FormDialog from "@/components/FormDialog";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  convertCurrencyAmount,
  formatCurrencyAmount,
  type DisplayCurrency,
} from "@/lib/currency-display";

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paymentMethodDetail?: string | null;
  description: string;
  status: string;
  date: string;
  attachments?: string[];
  isTest?: boolean;
  providerVerified?: boolean;
  donorAppealMessage?: string | null;
  reviewNote?: string | null;
}

interface SummaryRow {
  status: string;
  currency: DisplayCurrency;
  _sum: { amount: string | null };
  _count: { _all: number };
}

export default function DonorDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [paymentAccess, setPaymentAccess] = useState<{
    bmc: boolean;
    razorpay: boolean;
    razorpayRequested: boolean;
    razorpayRequestedAt: string | null;
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Transaction | null>(null);
  const [appealTarget, setAppealTarget] = useState<Transaction | null>(null);
  const [appealMessage, setAppealMessage] = useState("");

  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [usdToInr, setUsdToInr] = useState<number | null>(null);

  const [amount, setAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState<DisplayCurrency>("USD");
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [donationFrequency, setDonationFrequency] = useState<"ONE_TIME" | "MONTHLY">("ONE_TIME");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Stable callback used for the initial mount load AND every background
  // refresh. It never toggles loading/skeleton state and never clears existing
  // data, so background refreshes update the overview silently with no flicker;
  // a failed refresh keeps the last good data. The summary stats (total
  // contributed / pending / approved) are derived from `transactions`, so
  // refreshing this one endpoint refreshes the whole overview.
  const load = useCallback(async () => {
    const query = new URLSearchParams({ scope: "mine", limit: "25", page: String(page) });
    if (statusFilter !== "ALL") query.set("status", statusFilter);
    const res = await fetch(`/api/transactions?${query}`);
    if (!res.ok) throw new Error("Failed to load transactions");
    const data = await res.json();
    setTransactions(data.transactions || []);
    setSummary(data.summary || []);
    setTotalPages(data.totalPages || 1);
    setLoadError("");
  }, [page, statusFilter]);

  const loadPaymentAccess = useCallback(async () => {
    const response = await fetch("/api/payments/access", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load payment access");
    const data = await response.json();
    setPaymentAccess(data.access);
  }, []);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([load(), loadPaymentAccess()]);
  }, [load, loadPaymentAccess]);

  useEffect(() => {
    // Initial mount load: show the skeleton until the first fetch resolves.
    // Preserve the original initial-load error handling (empty the list), then
    // drop the skeleton once settled.
    // Both callbacks intentionally populate client state from external APIs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshDashboard()
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load donations"))
      .finally(() => setLoading(false));
  }, [refreshDashboard]);

  useEffect(() => {
    const saved = window.localStorage.getItem("sentinel_donor_display_currency");
    Promise.all([
      fetch("/api/exchange-rate", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ])
      .then(([data, me]) => {
        if (typeof data?.rate === "number") setUsdToInr(data.rate);
        const detected = data?.suggestedCurrency === "INR" ? "INR" : "USD";
        const accountCurrency = me?.user?.preferredCurrency;
        const selected: DisplayCurrency = accountCurrency === "INR" || accountCurrency === "USD"
          ? accountCurrency
          : saved === "INR" || saved === "USD" ? saved : detected;
        setDisplayCurrency(selected);
        setFormCurrency(selected);
      })
      .catch(() => {
        const fallback: DisplayCurrency = saved === "INR" || saved === "USD"
          ? saved
          : Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta"
            || Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata"
            ? "INR"
            : "USD";
        setDisplayCurrency(fallback);
        setFormCurrency(fallback);
      });
  }, []);

  // Background refresh on focus / visibility regain + every 30s while visible.
  useAutoRefresh(refreshDashboard, 30000);

  const approvedSummary = summary.filter((row) => row.status === "APPROVED");
  const contributionNeedsRate = approvedSummary.some((row) => row.currency !== displayCurrency);
  const totalContributed = contributionNeedsRate && !usdToInr
    ? null
    : approvedSummary.reduce(
        (sum, row) => sum + convertCurrencyAmount(
          Number(row._sum.amount || 0),
          row.currency,
          displayCurrency,
          usdToInr,
        ),
        0,
      );
  const pendingCount = summary.filter((row) => row.status === "PENDING").reduce((sum, row) => sum + row._count._all, 0);
  const approvedCount = approvedSummary.reduce((sum, row) => sum + row._count._all, 0);
  const donationCount = summary.reduce((sum, row) => sum + row._count._all, 0);

  const filteredTransactions =
    statusFilter === "ALL"
      ? transactions
      : transactions.filter((t) => t.status === statusFilter);

  function chooseDisplayCurrency(next: DisplayCurrency) {
    setDisplayCurrency(next);
    setFormCurrency(next);
    window.localStorage.setItem("sentinel_donor_display_currency", next);
    fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredCurrency: next }) }).catch(() => {});
  }

  function editPending(tx: Transaction) {
    setEditTarget(tx);
    setEditAmount(tx.amount);
    setEditDescription(tx.description);
    setFormError("");
  }

  async function submitPendingEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editTarget) return;
    const tx = editTarget;
    setMutatingId(tx.id);
    try {
      const response = await fetch(`/api/transactions/${tx.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: editAmount, description: editDescription }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update donation");
      await load();
      setEditTarget(null);
    } catch (error) { setFormError(error instanceof Error ? error.message : "Could not update donation"); }
    finally { setMutatingId(null); }
  }

  async function attachProof(tx: Transaction, fileList: FileList | null) {
    if (!fileList?.length) return;
    const existingCount = tx.attachments?.length ?? 0;
    if (existingCount >= 10) {
      setFormError("This donation already has the maximum of 10 proof files.");
      return;
    }
    if (fileList.length > 10 - existingCount) {
      setFormError(`You can add only ${10 - existingCount} more proof file${10 - existingCount === 1 ? "" : "s"}.`);
      return;
    }
    const invalid = Array.from(fileList).find((file) => !file.type.startsWith("image/"));
    if (invalid) {
      setFormError(`“${invalid.name}” is not an image.`);
      return;
    }
    setMutatingId(tx.id);
    try {
      const form = new FormData();
      Array.from(fileList).forEach((file) => form.append("files", file));
      const upload = await fetch("/api/attachments", { method: "POST", body: form });
      const uploadData = await upload.json().catch(() => null);
      if (!upload.ok) throw new Error(uploadData?.error || "Could not upload proof");
      const response = await fetch(`/api/transactions/${tx.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachments: [...(tx.attachments || []), ...(uploadData.urls || [])] }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not attach proof");
      await load();
    } catch (error) { setFormError(error instanceof Error ? error.message : "Could not attach proof"); }
    finally { setMutatingId(null); }
  }

  function cancelPending(tx: Transaction) {
    setCancelTarget(tx);
  }

  async function confirmCancelPending() {
    if (!cancelTarget) return;
    const tx = cancelTarget;
    setMutatingId(tx.id);
    try {
      const response = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by donor" }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not cancel donation");
      await load();
      setCancelTarget(null);
    } catch (error) { setFormError(error instanceof Error ? error.message : "Could not cancel donation"); }
    finally { setMutatingId(null); }
  }

  function appealRejected(tx: Transaction) {
    setAppealTarget(tx);
    setAppealMessage(tx.donorAppealMessage || "");
    setFormError("");
  }

  async function submitAppeal(event: React.FormEvent) {
    event.preventDefault();
    if (!appealTarget || !appealMessage.trim()) return;
    const tx = appealTarget;
    setMutatingId(tx.id);
    try {
      const response = await fetch(`/api/transactions/${tx.id}/appeal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: appealMessage }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not send appeal");
      await load();
      setAppealTarget(null);
    } catch (error) { setFormError(error instanceof Error ? error.message : "Could not send appeal"); }
    finally { setMutatingId(null); }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    const remaining = 10 - files.length;
    if (selected.length > remaining) {
      setFormError(`You can select only ${remaining} more proof image${remaining === 1 ? "" : "s"}.`);
      e.target.value = "";
      return;
    }
    const valid = selected.filter(f => {
      if (f.size > 20 * 1024 * 1024) { setFormError(`${f.name} exceeds 20MB`); return false; }
      if (!f.type.startsWith("image/")) { setFormError(`${f.name} is not an image`); return false; }
      return true;
    });
    setFiles(prev => [...prev, ...valid]);
    valid.forEach(f => {
      const reader = new FileReader();
      reader.onload = (ev) => setPreviews(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError("");

    try {
      let attachmentUrls: string[] = [];
      if (files.length > 0) {
        setUploading(true);
        const fd = new FormData();
        files.forEach(f => fd.append("files", f));
        const uploadRes = await fetch("/api/attachments", { method: "POST", body: fd });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => null);
          throw new Error(err?.error || "Upload failed");
        }
        const uploadData = await uploadRes.json();
        attachmentUrls = uploadData.urls;
        setUploading(false);
      }

      const desc =
        reference.trim() || `Donation via ${method}`;
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency: formCurrency,
          method,
          direction: "IN",
          type: "DONATION",
          description: desc,
          donationFrequency,
          attachments: attachmentUrls,
          scope: "mine",
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
      setDonationFrequency("ONE_TIME");
      setFiles([]);
      setPreviews([]);
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
    <div className="pb-20 md:pb-0">
      <ConfirmDialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)} onConfirm={() => { void confirmCancelPending(); }} title="Cancel this pending submission?" message="It will remain in the audit history as voided." confirmLabel="Cancel submission" loading={Boolean(cancelTarget && mutatingId === cancelTarget.id)} />
      <FormDialog open={editTarget !== null} title="Edit pending donation" description="Update the amount and payment reference before an admin reviews it." submitLabel="Save changes" loading={Boolean(editTarget && mutatingId === editTarget.id)} error={formError} onClose={() => setEditTarget(null)} onSubmit={submitPendingEdit}>
        <label htmlFor="edit-donation-amount" className="block text-xs font-semibold text-text-secondary">Amount</label>
        <input id="edit-donation-amount" autoFocus required inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-3 py-2 text-text-primary" />
        <label htmlFor="edit-donation-description" className="block text-xs font-semibold text-text-secondary">Description or reference</label>
        <input id="edit-donation-description" required value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-3 py-2 text-text-primary" />
      </FormDialog>
      <FormDialog open={appealTarget !== null} title="Request another review" description="Explain what the admins should reconsider." submitLabel="Send appeal" loading={Boolean(appealTarget && mutatingId === appealTarget.id)} error={formError} onClose={() => setAppealTarget(null)} onSubmit={submitAppeal}>
        <label htmlFor="donation-appeal-message" className="block text-xs font-semibold text-text-secondary">Appeal message</label>
        <textarea id="donation-appeal-message" autoFocus required rows={4} value={appealMessage} onChange={(event) => setAppealMessage(event.target.value)} className="w-full resize-none rounded-lg border border-[var(--border)] bg-bg-deep px-3 py-2 text-text-primary" />
      </FormDialog>
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">
            My <span className="font-display text-lime">Donations</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Your contributions at a glance
          </p>
        </div>
        <button
          data-tour="new-donation"
          onClick={() => {
            setShowForm(!showForm);
            setFormError("");
          }}
          className="bg-lime text-bg-void font-semibold px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm whitespace-nowrap hover:bg-lime/90 transition-colors shrink-0"
        >
          {showForm ? "Cancel" : "Record Manual"}
        </button>
      </div>
      {loadError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-coral/20 bg-coral/8 p-3 text-sm text-coral"><span>{loadError}</span><button type="button" onClick={() => { void refreshDashboard().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load donations")); }} className="rounded-lg border border-coral/30 px-3 py-1 text-xs font-semibold">Retry</button></div>}

      {/* Manual submission opens directly below its trigger. */}
      {success && (
        <div className="mb-4 p-4 rounded-lg bg-mint/8 border border-mint/20 text-mint text-sm animate-fade-in">
          Manual payment submitted! Your donation is pending admin approval.
        </div>
      )}

      {showForm && (
        <div className="glass-card p-4 sm:p-6 mb-6 animate-scale-in">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-5">
            Record an existing payment
          </div>
          <FormExample lines={["Amount: 1000 · Currency: INR · Method: UPI", "Reference: UPI transaction ID or note"]} />
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">Donation frequency</span>
              <div className="inline-flex rounded-xl border border-[var(--border)] bg-bg-deep p-1">
                {(["ONE_TIME", "MONTHLY"] as const).map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    onClick={() => setDonationFrequency(frequency)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${donationFrequency === frequency ? "bg-lime text-bg-void" : "text-text-secondary"}`}
                  >
                    {frequency === "MONTHLY" ? "Monthly" : "One time"}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label htmlFor="manual-donation-amount" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Amount
                </label>
                <input
                  id="manual-donation-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }}
                  placeholder="0"
                  required
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[var(--border-active)] transition-colors"
                />
              </div>
              <div>
                <label htmlFor="manual-donation-currency" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Currency
                </label>
                <Dropdown
                  id="manual-donation-currency"
                  value={formCurrency}
                  options={[
                    { value: "INR", label: "INR (₹)" },
                    { value: "USD", label: "USD ($)" },
                  ]}
                  onChange={(value) => setFormCurrency(value as DisplayCurrency)}
                />
              </div>
              <div>
                <label htmlFor="manual-donation-method" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Method
                </label>
                <Dropdown
                  id="manual-donation-method"
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

            <div className="mb-5">
              <label htmlFor="manual-donation-reference" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Reference / Proof Note
              </label>
              <input
                id="manual-donation-reference"
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

            <div className="mb-5">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
                Proof Screenshots <span className="normal-case tracking-normal">(optional, max 20MB each)</span>
              </div>
              <div className="flex flex-wrap gap-3 mb-3">
                {previews.map((src, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)] group">
                    <Image src={src} alt="" fill unoptimized className="object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove proof image ${i + 1}`}
                      onClick={() => removeFile(i)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <span className="text-white text-lg">&times;</span>
                    </button>
                  </div>
                ))}
                <label className={`w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center transition-colors ${files.length >= 10 ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-[var(--border-hover)]"}`}>
                  <span className="text-text-tertiary text-xl">+</span>
                  <span className="text-text-tertiary text-[8px] uppercase tracking-wider">Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={files.length >= 10}
                    onChange={handleFiles}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-coral/8 border border-coral/20 text-coral text-sm">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || uploading || !amount}
              className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
            >
              {uploading ? "Uploading..." : submitting ? "Submitting..." : "Submit Donation"}
            </button>
          </form>
        </div>
      )}

      {paymentAccess?.razorpay && (
        <RazorpayDonationCard onSuccess={async () => {
          await Promise.all([load(), loadPaymentAccess()]);
        }} />
      )}
      {paymentAccess && !paymentAccess.razorpay && (
        <RazorpayAccessBanner
          requested={paymentAccess.razorpayRequested}
          onRequested={(requestedAt) => setPaymentAccess((current) => current
            ? { ...current, razorpayRequested: true, razorpayRequestedAt: requestedAt }
            : current)}
        />
      )}
      {paymentAccess?.bmc && (
        <BmcSupportCard />
      )}
      {paymentAccess && !paymentAccess.bmc && !paymentAccess.razorpay && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-bg-deep p-5 text-sm text-text-secondary">
          Online checkout is not enabled for this account. Contact an administrator if you need a payment link.
        </div>
      )}

      <div className="mb-4 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[.1em] text-text-tertiary">History amounts</div>
          <p className="mt-1 text-xs text-text-tertiary">Display totals and donation history in your preferred currency.</p>
        </div>
        <CurrencyToggle value={displayCurrency} onChange={chooseDisplayCurrency} exchangeRate={usdToInr} />
      </div>

      {/* Stats summary */}
      <div data-tour="donor-stats" className="grid min-w-0 grid-cols-1 gap-3 mb-6 sm:grid-cols-3">
        <div className="stat-card" style={{ "--accent": "var(--mint)" } as React.CSSProperties}>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
            Total Contributed
          </div>
          <div className="text-xl font-bold text-mint">
            {totalContributed == null ? "Loading rate…" : formatCurrencyAmount(totalContributed, displayCurrency)}
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

      {/* Filter tabs */}
      {donationCount > 0 && (
        <div data-tour="donation-history" className="flex flex-wrap items-center gap-2 mb-4">
          {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
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
                  {summary.filter((row) => row.status === s).reduce((sum, row) => sum + row._count._all, 0)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Transaction list */}
      {filteredTransactions.length === 0 ? (
        <div data-tour="donation-history" className="card p-8 text-center">
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
              className="card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {tx.description}
                  {tx.isTest && <span className="ml-2 rounded bg-violet/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-violet">Test</span>}
                </div>
                <div className="text-text-tertiary text-xs mt-1">
                  <span className="mr-2">{new Date(tx.date).toLocaleDateString()}</span>
                  <PaymentMethodBadge method={tx.method} detail={tx.paymentMethodDetail} />
                  <span className="ml-1">&middot; paid in {tx.currency}</span>
                </div>
                {tx.attachments && tx.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tx.attachments.map((url) => (
                      <AttachmentViewer key={url} url={url} className="max-w-full truncate rounded-full border border-violet/20 bg-violet/8 px-2.5 py-1 text-[10px] text-violet">
                        📎 {attachmentName(url, "Proof")}
                      </AttachmentViewer>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 sm:ml-3">
                <span className="text-mint font-semibold">
                  {formatCurrencyAmount(
                    convertCurrencyAmount(Number(tx.amount), tx.currency, displayCurrency, usdToInr),
                    displayCurrency,
                  )}
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
                {tx.status === "PENDING" && !tx.providerVerified && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button disabled={mutatingId === tx.id} onClick={() => editPending(tx)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                    <label className={`btn-secondary px-2.5 py-1 text-[11px] ${(tx.attachments?.length ?? 0) >= 10 ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
                      {(tx.attachments?.length ?? 0) >= 10 ? "Proof limit reached" : `Add proof (${10 - (tx.attachments?.length ?? 0)} left)`}
                      <input type="file" accept="image/*" multiple disabled={(tx.attachments?.length ?? 0) >= 10} className="hidden" onChange={(event) => { void attachProof(tx, event.target.files); event.target.value = ""; }} />
                    </label>
                    <button disabled={mutatingId === tx.id} onClick={() => cancelPending(tx)} className="px-2.5 py-1 text-[11px] text-coral">Cancel</button>
                  </div>
                )}
                {tx.status === "REJECTED" && (
                  <button disabled={mutatingId === tx.id} onClick={() => appealRejected(tx)} className="btn-secondary px-2.5 py-1 text-[11px]">
                    {tx.donorAppealMessage ? "Update appeal" : "Appeal"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="btn-secondary px-4 py-2 text-xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
          <button className="btn-secondary px-4 py-2 text-xs" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
        </div>
      )}
    </div>
  );
}
