"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageTour from "@/components/PageTour";

type Tx = { id: string; description: string; amount: string; currency: string; date: string; attachments: string[]; linkedService?: { id: string; name: string } | null };
type Alert = { id: string; title: string; severity: string; message: string; service?: { id: string; name: string } | null; vpsServer?: { id: string; name: string } | null };
type ReconciliationData = { unmatchedBmc?: unknown[]; unmatchedRazorpayOrders?: unknown[]; possibleDuplicates?: unknown[] };

export default function AttentionPage() {
  const [pending, setPending] = useState<Tx[]>([]);
  const [missingReceipts, setMissingReceipts] = useState<Tx[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reconciliation, setReconciliation] = useState({ bmc: 0, razorpay: 0, duplicates: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      fetch("/api/transactions?status=PENDING&limit=20", { cache: "no-store" }).then((r) => r.ok ? r.json() : { transactions: [] }),
      fetch("/api/transactions?direction=OUT&status=APPROVED&limit=100", { cache: "no-store" }).then((r) => r.ok ? r.json() : { transactions: [] }),
      fetch("/api/alerts?status=OPEN", { cache: "no-store" }).then((r) => r.ok ? r.json() : { alerts: [] }),
      fetch("/api/reconciliation", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([pendingData, expenseData, alertData, rawReconciliationData]) => {
      const reconciliationData = rawReconciliationData as ReconciliationData;
      setPending(pendingData.transactions || []);
      setMissingReceipts((expenseData.transactions || []).filter((transaction: Tx) => !transaction.attachments?.length).slice(0, 20));
      setAlerts((alertData.alerts || []).slice(0, 20));
      setReconciliation({ bmc: reconciliationData.unmatchedBmc?.length || 0, razorpay: reconciliationData.unmatchedRazorpayOrders?.length || 0, duplicates: reconciliationData.possibleDuplicates?.length || 0 });
      setLoading(false);
    });
  }, []);

  const reconcileCount = reconciliation.bmc + reconciliation.razorpay + reconciliation.duplicates;
  return <div className="min-w-0"><div className="mb-6"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-amber">One action inbox</p><h1 className="mt-2 text-3xl font-extrabold">Needs <span className="font-display text-lime">attention</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Approvals, reconciliation, missing evidence and operational incidents—prioritised without searching across Sentinel.</p></div>
    <div data-tour="attention-summary" className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4"><Summary label="Pending approvals" count={pending.length} href="/admin/transactions?status=PENDING" tone="text-amber" /><Summary label="Reconciliation" count={reconcileCount} href="/admin/reconciliation" tone="text-violet" /><Summary label="Missing receipts" count={missingReceipts.length} href="#missing-receipts" tone="text-coral" /><Summary label="Operational alerts" count={alerts.length} href="/admin/alerts" tone="text-mint" /></div>
    {loading ? <div className="skeleton h-72 w-full" /> : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><InboxSection title="Pending approvals" empty="No transactions need approval.">{pending.map((transaction) => <AttentionRow key={transaction.id} title={transaction.description} detail={`${transaction.currency} ${Number(transaction.amount).toLocaleString()} · ${new Date(transaction.date).toLocaleDateString()}`} href={`/admin/transactions?status=PENDING&transactionId=${transaction.id}`} action="Review" />)}</InboxSection><InboxSection title="Reconciliation" empty="Provider records are matched."><AttentionRow title="Unmatched provider payments" detail={`${reconciliation.bmc} BMC · ${reconciliation.razorpay} Razorpay · ${reconciliation.duplicates} possible duplicate groups`} href="/admin/reconciliation" action="Open" /></InboxSection><div id="missing-receipts"><InboxSection title="Missing receipts" empty="Recent expenses have documentation.">{missingReceipts.map((transaction) => <AttentionRow key={transaction.id} title={transaction.description} detail={`${transaction.currency} ${Number(transaction.amount).toLocaleString()}${transaction.linkedService ? ` · ${transaction.linkedService.name}` : ""}`} href={`/admin/transactions?transactionId=${transaction.id}`} action="Upload" />)}</InboxSection></div><InboxSection title="Operational alerts" empty="No active incidents.">{alerts.map((alert) => <AttentionRow key={alert.id} title={alert.title} detail={`${alert.severity} · ${alert.message}`} href="/admin/alerts" action="Resolve" />)}</InboxSection></div>}
    <PageTour pageKey="admin-attention" />
  </div>;
}

function Summary({ label, count, href, tone }: { label: string; count: number; href: string; tone: string }) { return <Link href={href} className="card min-w-0 p-4 transition hover:border-lime/20"><p className="text-2xl font-extrabold sm:text-3xl"><span className={tone}>{count}</span></p><p className="mt-1 text-xs leading-5 text-text-secondary sm:text-sm">{label}</p></Link>; }
function InboxSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const has = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section className="card min-w-0 overflow-hidden"><h2 className="border-b border-[var(--border)] px-4 py-3 font-mono text-[10px] uppercase tracking-[.12em] text-text-secondary">{title}</h2><div className="divide-y divide-[var(--border)]">{has ? children : <p className="p-5 text-sm text-text-tertiary">{empty}</p>}</div></section>; }
function AttentionRow({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) { return <div className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-semibold">{title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">{detail}</p></div><Link href={href} className="w-full shrink-0 rounded-full border border-lime/20 px-3 py-2 text-center text-xs font-semibold text-lime sm:w-auto">{action}</Link></div>; }
