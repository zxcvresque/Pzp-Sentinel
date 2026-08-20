"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ReconciliationData {
  unmatchedBmc: Array<{ id: string; amount: string; currency: string; date: string; description: string; bmcWebhookEvents: Array<{ supporterName: string | null; supporterEmail: string | null }> }>;
  unmatchedRazorpayOrders: Array<{ id: string; razorpayOrderId: string; paymentId: string | null; amount: number; currency: string; description: string; createdAt: string; user: { id: string; name: string } | null }>;
  pendingRazorpayEvents: Array<{ id: string; eventType: string; resourceId: string | null; status: string; createdAt: string }>;
  possibleDuplicates: Array<{ reason: string; transactions: Array<{ id: string; amount: string; currency: string; method: string; date: string; description: string }> }>;
}

export default function ReconciliationPage() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const load = useCallback(() => fetch("/api/reconciliation", { cache: "no-store" }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load reconciliation inbox");
    setData(body);
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load reconciliation inbox")), []);
  useEffect(() => { void load(); }, [load]);

  async function captureOrder(orderId: string) {
    setWorking(orderId);
    const response = await fetch("/api/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CAPTURE_RAZORPAY_ORDER", orderId }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || "Reconciliation failed");
    else await load();
    setWorking("");
  }

  async function syncRazorpay() {
    setWorking("sync");
    setSyncResult("");
    const response = await fetch("/api/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SYNC_RAZORPAY" }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error || "Razorpay sync failed");
    else {
      setSyncResult(`Checked ${body.checked}; recovered ${body.recovered}; ${body.errors?.length || 0} errors.`);
      await load();
    }
    setWorking("");
  }

  if (error) return <div className="rounded-xl border border-coral/20 bg-coral/8 p-4 text-coral">{error}</div>;
  if (!data) return <div className="skeleton h-72 w-full" />;
  const total = data.unmatchedBmc.length + data.unmatchedRazorpayOrders.length + data.pendingRazorpayEvents.length + data.possibleDuplicates.length;

  return <div>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-extrabold">Reconciliation <span className="font-display text-lime">Inbox</span></h1><p className="mt-2 text-sm text-text-secondary">Unmatched provider payments, incomplete provider processing and possible duplicate ledger entries.</p>{syncResult && <p className="mt-2 text-xs text-mint">{syncResult}</p>}</div><button onClick={syncRazorpay} disabled={working === "sync"} className="rounded-full bg-lime px-5 py-2 text-sm font-semibold text-bg-void disabled:opacity-40">{working === "sync" ? "Syncing…" : "Sync Razorpay now"}</button></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-4"><Stat label="Total flags" value={total} /><Stat label="BMC unmatched" value={data.unmatchedBmc.length} /><Stat label="Razorpay unmatched" value={data.unmatchedRazorpayOrders.length + data.pendingRazorpayEvents.length} /><Stat label="Possible duplicates" value={data.possibleDuplicates.length} /></div>

    <Section title="Unmatched BMC payments" empty="No unmatched BMC payments.">
      {data.unmatchedBmc.map((transaction) => <Row key={transaction.id} title={`${transaction.currency} ${Number(transaction.amount).toLocaleString()} · ${transaction.bmcWebhookEvents[0]?.supporterName || "Unknown supporter"}`} detail={`${transaction.description} · ${new Date(transaction.date).toLocaleString()}`}><Link href={`/admin/transactions?transactionId=${encodeURIComponent(transaction.id)}&reconcile=1`} className="pill">Assign donor</Link></Row>)}
    </Section>
    <Section title="Unmatched Razorpay orders" empty="No paid Razorpay orders are missing ledger entries.">
      {data.unmatchedRazorpayOrders.map((order) => <Row key={order.id} title={`${order.currency} ${(order.amount / 100).toLocaleString()} · ${order.user?.name || "Unlinked payer"}`} detail={`${order.razorpayOrderId} · ${order.paymentId || "No payment ID"}`}><button disabled={working === order.id || !order.paymentId} onClick={() => captureOrder(order.id)} className="pill text-lime disabled:opacity-40">Create ledger entry</button></Row>)}
    </Section>
    <Section title="Incomplete Razorpay webhooks" empty="No incomplete Razorpay webhook events.">
      {data.pendingRazorpayEvents.map((event) => <Row key={event.id} title={event.eventType} detail={`${event.resourceId || "Unknown resource"} · ${event.status} · ${new Date(event.createdAt).toLocaleString()}`} />)}
    </Section>
    <Section title="Possible duplicate transactions" empty="No likely duplicate transactions in the last 90 days.">
      {data.possibleDuplicates.map((group, index) => <div key={index} className="border-b border-[var(--border)] py-4 last:border-0"><p className="text-xs text-amber">{group.reason}</p>{group.transactions.map((transaction) => <p key={transaction.id} className="mt-2 text-sm"><span className="font-semibold">{transaction.currency} {Number(transaction.amount).toLocaleString()}</span> · {transaction.description} · {new Date(transaction.date).toLocaleString()} <code className="text-[10px] text-text-tertiary">{transaction.id}</code></p>)}<Link href="/admin/transactions" className="mt-3 inline-block text-xs text-lime">Review and void duplicate →</Link></div>)}
    </Section>
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="card p-4"><p className="font-mono text-[9px] uppercase tracking-[.1em] text-text-tertiary">{label}</p><p className={`mt-2 text-2xl font-bold ${value ? "text-coral" : "text-mint"}`}>{value}</p></div>; }
function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section className="card mb-5 p-5"><h2 className="mb-2 font-mono text-xs uppercase tracking-[.1em] text-text-secondary">{title}</h2>{hasChildren ? children : <p className="py-4 text-sm text-text-tertiary">{empty}</p>}</section>; }
function Row({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) { return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-4 last:border-0"><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-text-tertiary">{detail}</p></div>{children}</div>; }
