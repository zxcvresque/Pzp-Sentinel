"use client";

import { useCallback, useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";
import FormExample from "@/components/FormExample";
import PageTour from "@/components/PageTour";
import RazorpayDonationCard from "@/components/RazorpayDonationCard";
import BmcSupportCard from "@/components/BmcSupportCard";
import RazorpayAccessBanner from "@/components/RazorpayAccessBanner";
import PaymentMethodBadge from "@/components/PaymentMethodBadge";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

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
}

export default function DonorDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState("");
  const [paymentAccess, setPaymentAccess] = useState<{
    bmc: boolean;
    razorpay: boolean;
    razorpayRequested: boolean;
    razorpayRequestedAt: string | null;
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
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
    const res = await fetch("/api/transactions?limit=50");
    if (!res.ok) throw new Error("Failed to load transactions");
    const data = await res.json();
    setTransactions(data.transactions || []);
  }, []);

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
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [refreshDashboard]);

  // Background refresh on focus / visibility regain + every 30s while visible.
  useAutoRefresh(refreshDashboard, 30000);

  const approved = transactions.filter((t) => t.status === "APPROVED" && !t.isTest);
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

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
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
          currency,
          method,
          direction: "IN",
          type: "DONATION",
          description: desc,
          donationFrequency,
          attachments: attachmentUrls,
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
      {paymentAccess?.bmc && <BmcSupportCard />}
      {paymentAccess && !paymentAccess.bmc && !paymentAccess.razorpay && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-bg-deep p-5 text-sm text-text-secondary">
          Online checkout is not enabled for this account. Contact an administrator if you need a payment link.
        </div>
      )}

      {/* Stats summary */}
      <div data-tour="donor-stats" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
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
          Manual payment submitted! Your donation is pending admin approval.
        </div>
      )}

      {/* Submission form */}
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
              {/* Amount */}
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Amount
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }}
                  placeholder="0"
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

            {/* Proof screenshots */}
            <div className="mb-5">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
                Proof Screenshots <span className="normal-case tracking-normal">(optional, max 20MB each)</span>
              </div>
              <div className="flex flex-wrap gap-3 mb-3">
                {previews.map((src, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)] group">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <span className="text-white text-lg">&times;</span>
                    </button>
                  </div>
                ))}
                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--border-hover)] cursor-pointer flex flex-col items-center justify-center transition-colors">
                  <span className="text-text-tertiary text-xl">+</span>
                  <span className="text-text-tertiary text-[8px] uppercase tracking-wider">Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
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

      {/* Filter tabs */}
      {transactions.length > 0 && (
        <div data-tour="donation-history" className="flex flex-wrap items-center gap-2 mb-4">
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
                  {tx.currency !== "INR" && (
                    <span className="ml-1">&middot; {tx.currency}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 sm:ml-3">
                <span className="text-mint font-semibold">
                  {currencySymbol(tx.currency)}
                  {parseFloat(tx.amount).toLocaleString()}
                  {tx.attachments && tx.attachments.length > 0 && (
                    <span className="text-text-tertiary text-[10px] ml-1 font-normal">
                      📎 {tx.attachments.length}
                    </span>
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
              </div>
            </div>
          ))}
        </div>
      )}
      <PageTour pageKey="donor-overview" />
    </div>
  );
}
