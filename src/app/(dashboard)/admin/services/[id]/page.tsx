"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ServicesNav from "@/components/ServicesNav";
import TgUser from "@/components/TgUser";
import ShareButton from "@/components/ShareButton";
import AttachmentViewer, { attachmentName } from "@/components/AttachmentViewer";

interface ServiceDetail {
  id: string;
  name: string;
  category: string;
  price: string | null;
  currency: string | null;
  frequency: string | null;
  status: string | null;
  planUrl: string | null;
  expiryDate: string | null;
  lastRenewalDate: string | null;
  paidTxId: string | null;
  attachments: string[];
  transactions: Array<{ id: string; amount: string; currency: string; method: string; status: string; date: string; description: string; attachments: string[]; createdBy: { id: string; name: string; photoUrl: string | null; telegramUser: string | null } }>;
  credentials: Array<{ id: string; platform: string; label: string; status: string; expiresAt: string | null; updatedAt: string }>;
  reminders: Array<{ id: string; message: string; nextFire: string; repeatEvery: number | null; repeatUnit: string | null; channel: string }>;
  alerts: Array<{ id: string; kind: string; severity: string; title: string; message: string; dueAt: string | null }>;
}

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/services/${id}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load service");
        setService(data.service);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load service"));
  }, [id]);

  if (error) return <div className="rounded-xl border border-coral/20 bg-coral/8 p-4 text-coral">{error}</div>;
  if (!service) return <div className="skeleton h-72 w-full" />;

  return (
    <div data-share-target={`service:${service.id}`}>
      <ServicesNav role="ADMIN" />
      <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div><Link href="/admin/services" className="text-xs text-text-tertiary hover:text-lime">← Service catalogue</Link><h1 className="mt-2 text-3xl font-extrabold">{service.name}</h1><p className="mt-1 text-sm text-text-secondary">{service.category} · {service.status || "Untracked"}</p></div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex"><ShareButton entityType="service" entityId={service.id} contextTitle={service.name} contextDetails={`${service.category} service · ${(service.status || "untracked").toLowerCase()}${service.price ? ` · ${service.currency} ${Number(service.price).toLocaleString()} ${service.frequency?.toLowerCase() || ""}` : ""}`} className="py-2.5" /><Link href={`/admin/transactions/new?mode=RENEWAL&serviceId=${encodeURIComponent(service.id)}`} className="rounded-full bg-lime px-4 py-2.5 text-center text-sm font-semibold text-bg-void">Record renewal</Link>{service.planUrl && <a href={service.planUrl} target="_blank" rel="noreferrer" className="rounded-full border border-[var(--border)] px-4 py-2.5 text-center text-sm text-lime">Open plan ↗</a>}</div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Current cost" value={service.price ? `${service.currency} ${Number(service.price).toLocaleString()}` : "—"} />
        <Stat label="Billing" value={service.frequency?.toLowerCase() || "—"} />
        <Stat label="Next renewal" value={service.expiryDate ? new Date(service.expiryDate).toLocaleDateString() : "—"} />
        <Stat label="Last paid" value={service.lastRenewalDate ? new Date(service.lastRenewalDate).toLocaleDateString() : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={`Billing ledger · ${service.transactions.length}`}>
          {service.transactions.length ? service.transactions.map((transaction) => <div key={transaction.id} className="border-b border-[var(--border)] py-4 last:border-0"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{transaction.currency} {Number(transaction.amount).toLocaleString()}</span>{transaction.id === service.paidTxId && <span className="rounded-full bg-lime/10 px-2 py-0.5 font-mono text-[8px] uppercase text-lime">Initial payment</span>}<span className={`rounded-full px-2 py-0.5 font-mono text-[8px] uppercase ${transaction.status === "APPROVED" ? "bg-mint/10 text-mint" : transaction.status === "PENDING" ? "bg-amber/10 text-amber" : "bg-coral/10 text-coral"}`}>{transaction.status}</span></div><p className="mt-1 text-xs leading-5 text-text-secondary">{transaction.description} · {transaction.method}</p></div><span className="text-xs text-text-tertiary">{new Date(transaction.date).toLocaleDateString()}</span></div><div className="mt-3"><TgUser name={transaction.createdBy.name} photoUrl={transaction.createdBy.photoUrl} telegramUser={transaction.createdBy.telegramUser} size={22} /></div>{transaction.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{transaction.attachments.map((url) => <AttachmentViewer key={url} url={url} className="max-w-full truncate rounded-full border border-violet/20 bg-violet/8 px-3 py-1.5 text-[11px] text-violet">📎 {attachmentName(url, "Receipt")}</AttachmentViewer>)}</div>}</div>) : <Empty text="No linked payments yet." />}
        </Panel>

        <Panel title={`Credentials · ${service.credentials.length}`}>
          {service.credentials.length ? service.credentials.map((credential) => <Link key={credential.id} href="/admin/credentials" className="block border-b border-[var(--border)] py-3 last:border-0"><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{credential.label}</span><span className="text-text-tertiary">{credential.status}</span></div><p className="mt-1 text-xs text-text-secondary">{credential.platform}{credential.expiresAt ? ` · expires ${new Date(credential.expiresAt).toLocaleDateString()}` : ""}</p></Link>) : <Empty text="No linked credentials." />}
        </Panel>

        <Panel title={`Renewal reminders · ${service.reminders.length}`}>
          {service.reminders.length ? service.reminders.map((reminder) => <div key={reminder.id} className="border-b border-[var(--border)] py-3 last:border-0"><p className="text-sm font-semibold">{reminder.message}</p><p className="mt-1 text-xs text-text-tertiary">Next {new Date(reminder.nextFire).toLocaleString()} · {reminder.channel.toLowerCase()}</p></div>) : <Empty text="No active renewal reminder." />}
        </Panel>

        <Panel title={`Open alerts · ${service.alerts.length}`}>
          {service.alerts.length ? service.alerts.map((alert) => <div key={alert.id} className="border-b border-[var(--border)] py-3 last:border-0"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 font-mono text-[9px] ${alert.severity === "HIGH" ? "bg-coral/10 text-coral" : "bg-amber/10 text-amber"}`}>{alert.severity}</span><span className="text-sm font-semibold">{alert.title}</span></div><p className="mt-1 text-xs text-text-secondary">{alert.message}</p></div>) : <Empty text="No open alerts." />}
        </Panel>

        <Panel title={`Files · ${service.attachments.length}`}>
          {service.attachments.length ? service.attachments.map((url) => <AttachmentViewer key={url} url={url} className="block w-full truncate border-b border-[var(--border)] py-3 text-left text-sm text-violet last:border-0">📎 {attachmentName(url)}</AttachmentViewer>) : <Empty text="No service files." />}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="card p-4"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">{label}</p><p className="mt-2 text-lg font-bold text-text-primary">{value}</p></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="card p-5"><h2 className="mb-2 font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">{title}</h2>{children}</section>; }
function Empty({ text }: { text: string }) { return <p className="py-5 text-sm text-text-tertiary">{text}</p>; }
