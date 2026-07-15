"use client";

import { useEffect, useState } from "react";

export default function BmcSupportCard({ adminPreview = false }: { adminPreview?: boolean }) {
  const [config, setConfig] = useState<{ checkoutUrl: string | null; configured: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/bmc/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  if (!config) return null;
  if (!config.checkoutUrl && !adminPreview) return null;

  return (
    <section data-tour="bmc-support" className="relative mb-6 overflow-hidden rounded-[22px] border border-amber/20 bg-[linear-gradient(135deg,rgba(251,191,36,.09),rgba(20,20,25,.96)_55%)] p-4 shadow-[0_20px_70px_rgba(0,0,0,.2)] sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-amber/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber/25 bg-amber/10 text-xl" aria-hidden="true">☕</div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-text-primary">Buy Me a Coffee</h2>
              <span className="rounded-full border border-amber/20 bg-amber/8 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-amber">Hosted checkout</span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-text-secondary">
              Pay on Buy Me a Coffee&apos;s secure page. Completed support, extras, memberships, commissions, and wishlist payments are verified by the signed webhook and recorded in Sentinel automatically.
            </p>
            <div className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">
              <span className={`h-1.5 w-1.5 rounded-full ${config.configured ? "bg-mint" : "bg-amber"}`} />
              {config.configured ? "Automatic tracking enabled" : "Add BMC_PAGE_URL and webhook secret"}
            </div>
          </div>
        </div>
        {config.checkoutUrl ? (
          <a
            href={config.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-amber px-5 py-3 text-sm font-bold text-bg-void transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0"
          >
            Open BMC checkout <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="shrink-0 rounded-full border border-amber/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-amber">Setup required</span>
        )}
      </div>
    </section>
  );
}
