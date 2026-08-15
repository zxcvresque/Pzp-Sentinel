"use client";

import { useState } from "react";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import ServicesNav from "@/components/ServicesNav";
import TransactionAttachmentField from "@/components/TransactionAttachmentField";
import { SERVICE_TEMPLATES } from "@/lib/service-templates";

interface CredentialDraft {
  label: string;
  value: string;
  expiresAt: string;
}

export default function PurchaseWizardPage() {
  const [kind, setKind] = useState("ONE_TIME");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [method, setMethod] = useState("OTHER");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [category, setCategory] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [nextRenewal, setNextRenewal] = useState("");
  const [planUrl, setPlanUrl] = useState("");
  const [credentials, setCredentials] = useState<CredentialDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function selectTemplate(id: string) {
    setTemplateId(id);
    const template = SERVICE_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setCategory(template.category);
    setServiceName(template.name);
    setFrequency(template.frequency);
    setCredentials(template.credentialLabels.map((label) => ({ label, value: "", expiresAt: "" })));
  }

  function updateCredential(index: number, patch: Partial<CredentialDraft>) {
    setCredentials((current) => current.map((credential, itemIndex) => (
      itemIndex === index ? { ...credential, ...patch } : credential
    )));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount,
          currency,
          method,
          paymentDate,
          description,
          attachments,
          templateId: kind === "RECURRING" ? templateId : undefined,
          category: kind === "RECURRING" ? category : undefined,
          serviceName: kind === "RECURRING" ? serviceName : undefined,
          frequency: kind === "RECURRING" ? frequency : undefined,
          nextRenewal: kind === "RECURRING" ? nextRenewal : undefined,
          planUrl: kind === "RECURRING" ? planUrl : undefined,
          credentials: kind === "RECURRING"
            ? credentials.filter((credential) => credential.label.trim() && credential.value)
                .map((credential) => ({ ...credential, platform: serviceName }))
            : [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record purchase");
      const archiveFailures = (data.attachmentArchive || []).filter((item: { archived: boolean }) => !item.archived).length;
      setFeedback({
        tone: archiveFailures ? "error" : "success",
        text: archiveFailures
          ? `Purchase recorded, but ${archiveFailures} attachment archive failed and will retry automatically.`
          : kind === "RECURRING"
            ? "Transaction, service, credentials and renewal reminder recorded together."
            : "One-time purchase recorded.",
      });
      if (!archiveFailures) {
        setAmount("");
        setDescription("");
        setAttachments([]);
        setCredentials([]);
        setNextRenewal("");
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Could not record purchase" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <ServicesNav role="ADMIN" />
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold">Record <span className="font-display text-lime">Purchase / Service</span></h1>
        <p className="mt-2 text-sm text-text-secondary">Enter payment details once; recurring purchases create the linked service, secure credentials and renewal reminder automatically.</p>
      </div>

      {feedback && <div role="status" className={`mb-4 rounded-xl border p-4 text-sm ${feedback.tone === "success" ? "border-mint/20 bg-mint/8 text-mint" : "border-coral/20 bg-coral/8 text-coral"}`}>{feedback.text}</div>}

      <form onSubmit={submit} className="card overflow-hidden">
        <section className="border-b border-[var(--border)] p-5 sm:p-6">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">1 · What are you recording?</h2>
          <div className="grid grid-cols-2 rounded-xl border border-[var(--border)] bg-bg-deep p-1">
            {[["ONE_TIME", "One-time purchase"], ["RECURRING", "Recurring service"]].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-lg px-4 py-3 text-sm font-semibold ${kind === value ? "bg-lime/10 text-lime" : "text-text-tertiary"}`}>{label}</button>
            ))}
          </div>
        </section>

        <section className="space-y-4 border-b border-[var(--border)] p-5 sm:p-6">
          <h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">2 · Payment details</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Amount"><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input" /></Field>
            <Field label="Currency"><Dropdown value={currency} options={[{ value: "INR", label: "INR (₹)" }, { value: "USD", label: "USD ($)" }]} onChange={setCurrency} /></Field>
            <Field label="Payment source"><Dropdown value={method} options={[{ value: "OTHER", label: "Card / other" }, { value: "BANK", label: "Bank" }, { value: "UPI", label: "UPI" }]} onChange={setMethod} /></Field>
            <Field label="Payment date"><input required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="input" /></Field>
          </div>
          <Field label="Description"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What was purchased?" className="input" /></Field>
          <TransactionAttachmentField value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />
        </section>

        {kind === "RECURRING" && (
          <>
            <section className="space-y-4 border-b border-[var(--border)] p-5 sm:p-6">
              <h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">3 · Service and renewal</h2>
              <Field label="Template"><Dropdown value={templateId} options={[{ value: "", label: "Custom service" }, ...SERVICE_TEMPLATES.map((template) => ({ value: template.id, label: template.label }))]} onChange={selectTemplate} /></Field>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Category"><input required value={category} onChange={(event) => setCategory(event.target.value)} className="input" /></Field>
                <Field label="Service name"><input required value={serviceName} onChange={(event) => setServiceName(event.target.value)} className="input" /></Field>
                <Field label="Billing frequency"><Dropdown value={frequency} options={[{ value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "YEARLY", label: "Yearly" }]} onChange={setFrequency} /></Field>
                <Field label="Next renewal"><input required type="date" value={nextRenewal} onChange={(event) => setNextRenewal(event.target.value)} className="input" /></Field>
              </div>
              <Field label="Plan URL"><input type="url" value={planUrl} onChange={(event) => setPlanUrl(event.target.value)} placeholder="https://…" className="input" /></Field>
            </section>

            <section className="space-y-3 border-b border-[var(--border)] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">4 · Secure credentials (optional)</h2><p className="mt-1 text-xs text-text-tertiary">Values are encrypted in the credential vault, never copied into transaction descriptions.</p></div>
                <button type="button" onClick={() => setCredentials((current) => [...current, { label: "", value: "", expiresAt: "" }])} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-lime">Add credential</button>
              </div>
              {credentials.map((credential, index) => (
                <div key={index} className="grid gap-3 rounded-xl border border-[var(--border)] bg-bg-deep p-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]">
                  <input value={credential.label} onChange={(event) => updateCredential(index, { label: event.target.value })} placeholder="Label" className="input" />
                  <input type="password" autoComplete="new-password" value={credential.value} onChange={(event) => updateCredential(index, { value: event.target.value })} placeholder="Secret value" className="input" />
                  <input type="date" value={credential.expiresAt} onChange={(event) => updateCredential(index, { expiresAt: event.target.value })} className="input" title="Credential expiry (optional)" />
                  <button type="button" onClick={() => setCredentials((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="px-2 text-coral" aria-label="Remove credential">×</button>
                </div>
              ))}
            </section>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <p className="text-xs text-text-tertiary">{kind === "RECURRING" ? "Creates four linked records atomically." : "Creates one approved expense transaction."}</p>
          <div className="flex gap-2"><Link href="/admin/services" className="rounded-full px-4 py-2.5 text-sm text-text-secondary">Cancel</Link><button disabled={saving || uploading} className="rounded-full bg-lime px-6 py-2.5 text-sm font-semibold text-bg-void disabled:opacity-40">{saving ? "Recording…" : "Record purchase"}</button></div>
        </div>
      </form>
      <style>{`.input{width:100%;border:1px solid var(--border);border-radius:.5rem;background:var(--bg-deep);padding:.75rem 1rem;color:var(--text-primary);outline:none}.input:focus{border-color:rgba(190,242,100,.3)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</span>{children}</label>;
}
