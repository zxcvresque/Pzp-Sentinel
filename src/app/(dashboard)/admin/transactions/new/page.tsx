"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Dropdown from "@/components/Dropdown";
import PageTour from "@/components/PageTour";
import TransactionsNav from "@/components/TransactionsNav";
import TransactionAttachmentField from "@/components/TransactionAttachmentField";
import { SERVICE_TEMPLATES } from "@/lib/service-templates";
import { CUSTOM_REPEAT_UNITS, SERVICE_FREQUENCY_OPTIONS } from "@/lib/service-billing";

type Mode = "INCOME" | "PURCHASE" | "SUBSCRIPTION" | "RENEWAL" | "REVERSAL" | "ADJUSTMENT";
type ServiceAction = "NONE" | "LINK" | "CREATE";
type CredentialDraft = { label: string; value: string; expiresAt: string };
type Service = { id: string; name: string; category: string; price?: string | null; currency?: "INR" | "USD" | null; frequency?: string | null; expiryDate?: string | null };
type UserOption = { id: string; name: string; telegramUser?: string | null; photoUrl?: string | null };
type TransactionOption = { id: string; amount: string; currency: string; direction: string; description: string; date: string };

const MODES: Array<{ value: Mode; title: string; body: string; icon: string }> = [
  { value: "PURCHASE", title: "Purchase / expense", body: "One-time spend with receipt and optional service link.", icon: "↗" },
  { value: "SUBSCRIPTION", title: "New recurring service", body: "Record the first payment and create its service, reminder and access.", icon: "∞" },
  { value: "RENEWAL", title: "Service renewal", body: "Request approval before deducting and advancing the next cycle.", icon: "↻" },
  { value: "INCOME", title: "Income / donation", body: "Record incoming funds and optionally attribute a donor.", icon: "↙" },
  { value: "REVERSAL", title: "Refund / reversal", body: "Create a linked opposite entry without rewriting history.", icon: "↩" },
  { value: "ADJUSTMENT", title: "Balance adjustment", body: "Explain and audit a deliberate treasury correction.", icon: "±" },
];

const inputClass = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-bg-deep px-4 py-3 text-sm text-text-primary outline-none transition focus:border-lime/40";

export default function RecordTransactionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedMode = String(params.get("mode") || "").toUpperCase() as Mode;
  const [mode, setMode] = useState<Mode>(MODES.some((item) => item.value === requestedMode) ? requestedMode : "PURCHASE");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [method, setMethod] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fromUserId, setFromUserId] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [serviceAction, setServiceAction] = useState<ServiceAction>("NONE");
  const [serviceId, setServiceId] = useState(params.get("serviceId") || "");
  const [templateId, setTemplateId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [category, setCategory] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [customRepeatEvery, setCustomRepeatEvery] = useState("1");
  const [customRepeatUnit, setCustomRepeatUnit] = useState("MONTH");
  const [nextRenewal, setNextRenewal] = useState("");
  const [planUrl, setPlanUrl] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<CredentialDraft[]>([]);
  const [reversalOfId, setReversalOfId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [transactions, setTransactions] = useState<TransactionOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/services", { cache: "no-store" }).then((response) => response.ok ? response.json() : { services: [] }),
      fetch("/api/users", { cache: "no-store" }).then((response) => response.ok ? response.json() : { users: [] }),
      fetch("/api/transactions?status=APPROVED&limit=100", { cache: "no-store" }).then((response) => response.ok ? response.json() : { transactions: [] }),
    ]).then(([serviceData, userData, transactionData]) => {
      setServices(serviceData.services || []);
      setUsers(userData.users || []);
      setTransactions((transactionData.transactions || []).filter((item: TransactionOption & { voidedAt?: string | null }) => !item.voidedAt));
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (mode === "SUBSCRIPTION") setServiceAction("CREATE");
      else if (mode === "RENEWAL") setServiceAction("LINK");
      else if (mode !== "PURCHASE") setServiceAction("NONE");
      setDirection(mode === "INCOME" ? "IN" : "OUT");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    if (!serviceId || mode !== "RENEWAL") return;
    const service = services.find((item) => item.id === serviceId);
    if (!service) return;
    const timer = window.setTimeout(() => {
      if (!amount && service.price) setAmount(String(Number(service.price)));
      if (service.currency) setCurrency(service.currency);
      if (!description) setDescription(`Renew ${service.name}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [serviceId, services, mode, amount, description]);

  const selectedTemplate = useMemo(() => SERVICE_TEMPLATES.find((item) => item.id === templateId) || null, [templateId]);
  const showService = serviceAction !== "NONE" && ["PURCHASE", "SUBSCRIPTION", "RENEWAL"].includes(mode);
  const createService = serviceAction === "CREATE";

  function selectTemplate(value: string) {
    setTemplateId(value);
    const template = SERVICE_TEMPLATES.find((item) => item.id === value);
    if (!template) return;
    setCategory(template.category);
    setServiceName(template.name);
    setFrequency(template.frequency);
    setMetadata(Object.fromEntries(template.metadata.map((field) => [field.key, ""])));
    setCredentials(template.credentialLabels.map((label) => ({ label, value: "", expiresAt: "" })));
  }

  function selectReversal(value: string) {
    setReversalOfId(value);
    const original = transactions.find((item) => item.id === value);
    if (!original) return;
    setAmount(String(Number(original.amount)));
    setCurrency(original.currency === "USD" ? "USD" : "INR");
    setDescription(`Reversal: ${original.description}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/financial-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          amount,
          currency,
          method,
          description,
          date,
          fromUserId: mode === "INCOME" ? fromUserId || null : null,
          direction: mode === "ADJUSTMENT" ? direction : undefined,
          attachments,
          reversalOfId: mode === "REVERSAL" ? reversalOfId : null,
          service: {
            action: showService ? serviceAction : "NONE",
            id: serviceAction === "LINK" ? serviceId : undefined,
            templateId,
            name: serviceName,
            category,
            frequency,
            customRepeatEvery: frequency === "CUSTOM" ? customRepeatEvery : undefined,
            customRepeatUnit: frequency === "CUSTOM" ? customRepeatUnit : undefined,
            nextRenewal,
            planUrl,
            autoRenew,
            metadata,
          },
          credentials: createService ? credentials : [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not record transaction");
      router.push(`/admin/transactions?transactionId=${encodeURIComponent(data.transaction.id)}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not record transaction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl min-w-0">
      <TransactionsNav />
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[.18em] text-lime">One guided financial workflow</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Record <span className="font-display text-lime">transaction</span></h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Record the money movement once. Sentinel links any service, renewal, receipt, reminder and credentials without duplicating entry.</p>
      </div>

      <form onSubmit={submit} className="space-y-4" data-tour="financial-event-form">
        <section data-form-section className="space-y-4">
          <SectionHeading eyebrow="Step 1" title="What happened?" body="Choose the event that best describes the real-world transaction." />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((item) => (
              <button key={item.value} type="button" onClick={() => setMode(item.value)} className={`min-w-0 rounded-2xl border p-4 text-left transition ${mode === item.value ? "border-lime/35 bg-lime/[.08] shadow-[0_16px_50px_rgba(111,209,215,.08)]" : "border-[var(--border)] bg-bg-deep hover:bg-white/[.03]"}`}>
                <span className={`mb-3 grid h-9 w-9 place-items-center rounded-xl text-lg ${mode === item.value ? "bg-lime text-bg-void" : "bg-white/[.05] text-text-secondary"}`}>{item.icon}</span>
                <span className="block text-sm font-bold text-text-primary">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-text-tertiary">{item.body}</span>
              </button>
            ))}
          </div>
        </section>

        <section data-form-section className="space-y-4">
          <SectionHeading eyebrow="Step 2" title="Financial details" body={mode === "RENEWAL" ? "This renewal remains pending until an admin approves it." : "Provider-backed Razorpay and BMC entries come through reconciliation, not this manual form."} />
          {mode === "REVERSAL" && <Field label="Transaction to reverse"><Dropdown value={reversalOfId} options={[{ value: "", label: "Choose an approved transaction" }, ...transactions.map((item) => ({ value: item.id, label: `${item.currency} ${Number(item.amount).toLocaleString()} · ${item.description}` }))]} onChange={selectReversal} /></Field>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Amount"><input required inputMode="decimal" value={amount} onChange={(event) => /^\d*\.?\d*$/.test(event.target.value) && setAmount(event.target.value)} className={inputClass} /></Field>
            <Field label="Currency"><Dropdown value={currency} options={[{ value: "INR", label: "INR (₹)" }, { value: "USD", label: "USD ($)" }]} onChange={(value) => setCurrency(value as "INR" | "USD")} /></Field>
            {mode === "ADJUSTMENT" ? <Field label="Direction"><Dropdown value={direction} options={[{ value: "IN", label: "Increase balance" }, { value: "OUT", label: "Decrease balance" }]} onChange={(value) => setDirection(value as "IN" | "OUT")} /></Field> : <Field label="Payment source"><Dropdown value={method} options={[{ value: "OTHER", label: "Card / admin noted / other" }, { value: "BANK", label: "Bank transfer" }, { value: "UPI", label: "Confirmed direct UPI" }]} onChange={setMethod} /></Field>}
            <Field label="Transaction date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></Field>
          </div>
          <Field label="Description"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe what was paid for and why" className={inputClass} /></Field>
          {mode === "INCOME" && <Field label="Donor / source user"><Dropdown value={fromUserId} options={[{ value: "", label: "External or unlinked source" }, ...users.map((item) => ({ value: item.id, label: `${item.name}${item.telegramUser ? ` (@${item.telegramUser})` : ""}`, avatar: item.photoUrl || null }))]} onChange={setFromUserId} /></Field>}
        </section>

        {["PURCHASE", "SUBSCRIPTION", "RENEWAL"].includes(mode) && (
          <section data-form-section className="space-y-4">
            <SectionHeading eyebrow="Step 3" title="Service relationship" body="A payment may stand alone, link to an existing service, or create a recurring service." />
            {mode === "PURCHASE" && <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{([['NONE', 'No service'], ['LINK', 'Link existing'], ['CREATE', 'Create service']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setServiceAction(value)} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${serviceAction === value ? "border-lime/30 bg-lime/8 text-lime" : "border-[var(--border)] text-text-secondary"}`}>{label}</button>)}</div>}
            {serviceAction === "LINK" && <Field label={mode === "RENEWAL" ? "Service being renewed" : "Existing service"}><Dropdown value={serviceId} options={[{ value: "", label: "Choose service" }, ...services.map((item) => ({ value: item.id, label: `${item.name} · ${item.category}` }))]} onChange={setServiceId} /></Field>}
            {createService && <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Template"><Dropdown value={templateId} options={[{ value: "", label: "Custom service" }, ...SERVICE_TEMPLATES.map((item) => ({ value: item.id, label: item.label }))]} onChange={selectTemplate} /></Field>
                <Field label="Service name"><input required value={serviceName} onChange={(event) => setServiceName(event.target.value)} className={inputClass} /></Field>
                <Field label="Category"><input required value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} /></Field>
                <Field label="Billing frequency"><Dropdown value={frequency} options={SERVICE_FREQUENCY_OPTIONS.map((option) => ({ ...option }))} onChange={setFrequency} /></Field>
                {frequency === "CUSTOM" && <>
                  <Field label="Repeat every"><input required inputMode="numeric" min="1" step="1" type="number" value={customRepeatEvery} onChange={(event) => setCustomRepeatEvery(event.target.value)} className={inputClass} /></Field>
                  <Field label="Custom unit"><Dropdown value={customRepeatUnit} options={CUSTOM_REPEAT_UNITS.map((unit) => ({ value: unit, label: `${unit.charAt(0)}${unit.slice(1).toLowerCase()}${Number(customRepeatEvery) === 1 ? "" : "s"}` }))} onChange={setCustomRepeatUnit} /></Field>
                </>}
                <Field label="Next renewal"><input required type="date" value={nextRenewal} onChange={(event) => setNextRenewal(event.target.value)} className={inputClass} /></Field>
                <Field label="Plan / dashboard URL" extra="sm:col-span-2 lg:col-span-3"><input type="url" value={planUrl} onChange={(event) => setPlanUrl(event.target.value)} placeholder="https://…" className={inputClass} /></Field>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-4"><input type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--lime)]" /><span><span className="block text-sm font-semibold">Request renewal approval automatically</span><span className="mt-1 block text-xs leading-5 text-text-tertiary">Sentinel creates a pending transaction each cycle. Funds are deducted only after approval.</span></span></label>
              {selectedTemplate && <details className="rounded-xl border border-[var(--border)] bg-bg-deep p-4"><summary className="cursor-pointer text-sm font-semibold text-text-secondary">Advanced service fields</summary><div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{selectedTemplate.metadata.map((item) => <Field key={item.key} label={item.label}><input value={metadata[item.key] || ""} onChange={(event) => setMetadata((current) => ({ ...current, [item.key]: event.target.value }))} className={inputClass} /></Field>)}</div></details>}
            </>}
          </section>
        )}

        {createService && (
          <section data-form-section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><SectionHeading eyebrow="Step 4" title="Secure access (optional)" body="Credentials are encrypted and linked to the new service. They never enter the transaction description." /><button type="button" onClick={() => setCredentials((current) => [...current, { label: "", value: "", expiresAt: "" }])} className="w-full rounded-full border border-violet/25 px-4 py-2 text-xs font-semibold text-violet sm:w-auto">Add credential</button></div>
            <div className="space-y-3">{credentials.map((credential, index) => <div key={`${credential.label}-${index}`} className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_auto]"><input value={credential.label} onChange={(event) => setCredentials((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Credential label" className={inputClass} /><input type="password" autoComplete="new-password" value={credential.value} onChange={(event) => setCredentials((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="Secret value" className={inputClass} /><input type="date" value={credential.expiresAt} onChange={(event) => setCredentials((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expiresAt: event.target.value } : item))} className={inputClass} /><button type="button" onClick={() => setCredentials((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl border border-coral/20 px-3 py-2 text-xs font-semibold text-coral">Remove</button></div>)}</div>
          </section>
        )}

        <section data-form-section className="space-y-4">
          <SectionHeading eyebrow={createService ? "Step 5" : showService ? "Step 4" : "Step 3"} title={mode === "INCOME" ? "Proof and supporting files" : "Receipt / invoice"} body="Files remain private to authorised users and are archived to Sentinel’s attachments topic." />
          <TransactionAttachmentField value={attachments} onChange={setAttachments} onUploadingChange={setUploading} kind={mode === "INCOME" ? "PROOF" : "RECEIPT"} label={mode === "INCOME" ? "Proof / supporting documents" : "Receipt / invoice"} />
        </section>

        {error && <div role="alert" className="rounded-xl border border-coral/25 bg-coral/8 p-4 text-sm text-coral">{error}</div>}
        <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-bg-card/95 p-3 shadow-[0_20px_70px_rgba(0,0,0,.4)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <p className="text-xs leading-5 text-text-tertiary">{mode === "RENEWAL" ? "Creates a pending approval; no deduction occurs yet." : createService ? "Creates one linked financial workflow atomically." : "Creates one audited ledger entry."}</p>
          <div className="grid grid-cols-2 gap-2 sm:flex"><button type="button" onClick={() => router.back()} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm text-text-secondary">Cancel</button><button disabled={saving || uploading || !amount || !description.trim()} className="rounded-full bg-lime px-6 py-3 text-sm font-bold text-bg-void disabled:opacity-40">{uploading ? "Uploading…" : saving ? "Recording…" : mode === "RENEWAL" ? "Request approval" : "Record transaction"}</button></div>
        </div>
      </form>
      <PageTour pageKey="admin-record-transaction" />
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div><p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[var(--form-section-accent,var(--lime))]">{eyebrow}</p><h2 className="mt-1 text-lg font-extrabold text-text-primary sm:text-xl">{title}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-text-tertiary sm:text-sm">{body}</p></div>;
}

function Field({ label, children, extra = "" }: { label: string; children: React.ReactNode; extra?: string }) {
  return <label className={`block min-w-0 ${extra}`}><span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[.12em] text-text-secondary">{label}</span>{children}</label>;
}
