"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type BmcConfig = {
  checkoutUrl: string | null;
  accountSlug: string | null;
  configured: boolean;
};

const BMC_SCRIPT_ID = "sentinel-bmc-widget-script";
const BMC_ASSET_ROOT = "/Payment%20Apps%20Icons";
let bmcWidgetPromise: Promise<void> | null = null;

function widgetButton() {
  return document.getElementById("bmc-wbtn") as HTMLElement | null;
}

function waitForWidget(timeoutMs = 8000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (widgetButton()) {
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Buy Me a Coffee checkout did not initialize"));
      } else {
        window.setTimeout(check, 75);
      }
    };
    check();
  });
}

function ensureBmcWidget(accountSlug: string) {
  if (widgetButton()) return Promise.resolve();
  if (bmcWidgetPromise) return bmcWidgetPromise;

  bmcWidgetPromise = new Promise<void>((resolve, reject) => {
    document.getElementById(BMC_SCRIPT_ID)?.remove();
    const script = document.createElement("script");
    script.id = BMC_SCRIPT_ID;
    script.src = "https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js";
    script.async = true;
    script.dataset.name = "BMC-Widget";
    script.dataset.cfasync = "false";
    script.dataset.id = accountSlug;
    script.dataset.description = "Support Piratezparty on Buy Me a Coffee";
    script.dataset.message = "";
    script.dataset.color = "#FBBF24";
    script.dataset.position = "Right";
    script.dataset.x_margin = "18";
    script.dataset.y_margin = "18";
    script.onload = () => {
      window.dispatchEvent(new Event("DOMContentLoaded"));
      void waitForWidget().then(resolve, reject);
    };
    script.onerror = () => reject(new Error("Buy Me a Coffee checkout could not load"));
    document.head.appendChild(script);
  }).catch((error) => {
    bmcWidgetPromise = null;
    throw error;
  });

  return bmcWidgetPromise;
}

export default function BmcSupportCard({ adminPreview = false, guestToken }: { adminPreview?: boolean; guestToken?: string }) {
  const [config, setConfig] = useState<BmcConfig | null>(null);
  const [opening, setOpening] = useState(false);
  const [widgetError, setWidgetError] = useState("");

  useEffect(() => {
    const url = guestToken ? `/api/bmc/config?token=${encodeURIComponent(guestToken)}` : "/api/bmc/config";
    fetch(url, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [guestToken]);

  useEffect(() => {
    if (!config?.accountSlug) return;
    let active = true;
    void ensureBmcWidget(config.accountSlug)
      .catch((error) => {
        if (active) setWidgetError(error instanceof Error ? error.message : "BMC checkout could not load");
      });
    return () => { active = false; };
  }, [config?.accountSlug]);

  async function openCheckout() {
    if (!config?.accountSlug) return;
    setOpening(true);
    setWidgetError("");
    try {
      await ensureBmcWidget(config.accountSlug);
      const button = widgetButton();
      if (!button) throw new Error("Buy Me a Coffee checkout is unavailable");
      button.click();
    } catch (error) {
      setWidgetError(error instanceof Error ? error.message : "BMC checkout could not load");
    } finally {
      setOpening(false);
    }
  }

  if (!config) return null;
  if (!config.checkoutUrl && !adminPreview) return null;

  return (
    <section data-tour="bmc-support" className="relative mb-6 overflow-hidden rounded-[22px] border border-amber/20 bg-[linear-gradient(135deg,rgba(251,191,36,.09),rgba(20,20,25,.96)_55%)] p-4 shadow-[0_20px_70px_rgba(0,0,0,.2)] sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-amber/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber/25 bg-amber/10" aria-hidden="true">
            <Image src={`${BMC_ASSET_ROOT}/bmc-logo-no-background.png`} alt="" width={22} height={32} className="h-7 w-auto object-contain" />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-text-primary">Buy Me a Coffee</h2>
              <span className="rounded-full border border-amber/20 bg-amber/8 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-amber">Support Piratezparty</span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-text-secondary">
              Support Piratezparty with a contribution, membership, commission, or wishlist payment.
            </p>
            <div className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">
              <span className={`h-1.5 w-1.5 rounded-full ${config.configured ? "bg-mint" : "bg-amber"}`} />
              {config.configured ? "Secure checkout" : "Currently unavailable"}
            </div>
          </div>
        </div>
        {config.accountSlug ? (
          <button
            type="button"
            onClick={() => void openCheckout()}
            disabled={opening}
            aria-label={opening ? "Opening Buy Me a Coffee checkout" : "Support Piratezparty on Buy Me a Coffee"}
            aria-busy={opening}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-amber px-5 py-3 text-sm font-bold text-bg-void transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:cursor-wait disabled:opacity-70 lg:min-h-0 lg:bg-transparent lg:p-0"
          >
            <Image src={`${BMC_ASSET_ROOT}/bmc-logo-no-background.png`} alt="" width={20} height={29} className="h-6 w-auto object-contain lg:hidden" />
            <span className="lg:hidden">{opening ? "Opening checkout…" : "Buy me a coffee"}</span>
            <Image src={`${BMC_ASSET_ROOT}/bmc-button.png`} alt="" width={218} height={61} className="hidden h-12 w-auto object-contain lg:block" />
          </button>
        ) : (
          <span className="shrink-0 rounded-full border border-amber/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-amber">Unavailable</span>
        )}
      </div>
      {widgetError && <p role="status" className="relative mt-4 rounded-xl border border-coral/20 bg-coral/8 px-3.5 py-3 text-sm text-coral">{widgetError}. Please refresh and try again.</p>}
    </section>
  );
}
