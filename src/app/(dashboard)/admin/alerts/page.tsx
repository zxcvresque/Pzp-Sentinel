"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ServicesNav from "@/components/ServicesNav";
import PageTour from "@/components/PageTour";

type Alert = { id: string; kind: string; severity: string; title: string; message: string; status: string; dueAt: string | null; createdAt: string; service?: { id: string; name: string } | null; credential?: { id: string; label: string; platform: string } | null; vpsServer?: { id: string; name: string } | null };

export default function OperationalAlertsPage() {
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/alerts?status=${status}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setAlerts(data.alerts || []); setLoading(false);
  }, [status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const counts = useMemo(() => alerts.reduce((result, alert) => ({ ...result, [alert.severity]: (result[alert.severity] || 0) + 1 }), {} as Record<string, number>), [alerts]);

  async function toggle(alert: Alert) {
    setWorking(alert.id);
    await fetch("/api/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: alert.id, action: alert.status === "OPEN" ? "RESOLVE" : "REOPEN" }) });
    await load(); setWorking("");
  }

  return <div className="min-w-0">
    <ServicesNav role="ADMIN" />
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-amber">Operations inbox</p><h1 className="mt-2 text-3xl font-extrabold">Operational <span className="font-display text-lime">alerts</span></h1><p className="mt-2 max-w-2xl text-sm text-text-secondary">Renewals, overdue costs, credential expiry, server health and process incidents in one actionable view.</p></div><div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-bg-deep p-1"><button onClick={() => setStatus("OPEN")} className={`rounded-lg px-4 py-2 text-sm ${status === "OPEN" ? "bg-amber/10 text-amber" : "text-text-tertiary"}`}>Open</button><button onClick={() => setStatus("RESOLVED")} className={`rounded-lg px-4 py-2 text-sm ${status === "RESOLVED" ? "bg-mint/10 text-mint" : "text-text-tertiary"}`}>Resolved</button></div></div>
    <div data-tour="alert-summary" className="mb-5 grid grid-cols-3 gap-2 sm:max-w-lg"><Stat label="High" value={counts.HIGH || 0} tone="text-coral" /><Stat label="Normal" value={counts.NORMAL || 0} tone="text-amber" /><Stat label="Low" value={counts.LOW || 0} tone="text-violet" /></div>
    {loading ? <div className="space-y-3">{[1,2,3].map((item) => <div key={item} className="skeleton h-36 w-full" />)}</div> : alerts.length === 0 ? <div className="card p-8 text-center text-sm text-text-tertiary">No {status.toLowerCase()} operational alerts.</div> : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{alerts.map((alert) => <article key={alert.id} className="min-w-0 rounded-2xl border border-[var(--border)] bg-bg-card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 font-mono text-[8px] uppercase ${alert.severity === "HIGH" ? "bg-coral/10 text-coral" : alert.severity === "LOW" ? "bg-violet/10 text-violet" : "bg-amber/10 text-amber"}`}>{alert.severity}</span><span className="font-mono text-[9px] uppercase text-text-tertiary">{alert.kind.replaceAll("_", " ")}</span></div><h2 className="mt-2 break-words text-base font-bold">{alert.title}</h2></div><button disabled={working === alert.id} onClick={() => void toggle(alert)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40">{alert.status === "OPEN" ? "Resolve" : "Reopen"}</button></div><p className="mt-2 break-words text-sm leading-6 text-text-secondary">{alert.message}</p><div className="mt-4 flex flex-wrap items-center gap-2 text-xs">{alert.service && <Link href={`/admin/services/${alert.service.id}`} className="rounded-full bg-lime/8 px-3 py-1.5 text-lime">Service · {alert.service.name}</Link>}{alert.credential && <Link href="/admin/credentials" className="rounded-full bg-violet/8 px-3 py-1.5 text-violet">Credential · {alert.credential.label}</Link>}{alert.vpsServer && <Link href="/admin/vps" className="rounded-full bg-mint/8 px-3 py-1.5 text-mint">VPS · {alert.vpsServer.name}</Link>}{alert.dueAt && <span className="text-text-tertiary">Due {new Date(alert.dueAt).toLocaleString()}</span>}</div></article>)}</div>}
    <PageTour pageKey="admin-alerts" />
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className="card min-w-0 p-3"><p className="truncate font-mono text-[8px] uppercase text-text-tertiary">{label}</p><p className={`mt-1 text-xl font-extrabold ${tone}`}>{value}</p></div>; }
