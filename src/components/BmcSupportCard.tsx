"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Image from "next/image";

type BmcConfig = {
  checkoutUrl: string | null;
  accountSlug: string | null;
  configured: boolean;
};

const BMC_ASSET_ROOT = "/Payment%20Apps%20Icons";

type TelegramLinkOpener = {
  initData?: string;
  openLink?: (url: string) => void;
};

export default function BmcSupportCard({ adminPreview = false, guestToken }: { adminPreview?: boolean; guestToken?: string }) {
  const [config, setConfig] = useState<BmcConfig | null>(null);
  const [intent, setIntent] = useState<{ code: string; expiresAt: string; checkoutUrl: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [donationFrequency, setDonationFrequency] = useState<"ONE_TIME" | "MONTHLY">("ONE_TIME");

  useEffect(() => {
    const url = guestToken ? `/api/bmc/config?token=${encodeURIComponent(guestToken)}` : "/api/bmc/config";
    fetch(url, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [guestToken]);

  function openCheckout(event: MouseEvent<HTMLAnchorElement>) {
    const webApp = window.Telegram?.WebApp as unknown as TelegramLinkOpener | undefined;
    if (!config?.checkoutUrl || !webApp?.initData || !webApp.openLink) return;

    event.preventDefault();
    webApp.openLink(config.checkoutUrl);
  }

  async function prepareCheckout() {
    setPreparing(true);
    setError("");
    try {
      const response = await fetch("/api/bmc/checkout-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationFrequency }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not prepare BMC checkout");
      setIntent(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not prepare BMC checkout");
    } finally {
      setPreparing(false);
    }
  }

  async function copyCode() {
    if (!intent) return;
    try {
      await navigator.clipboard.writeText(intent.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy failed. Select the reference code and copy it manually.");
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
            {!adminPreview && !guestToken && (
              <div className="mt-4 inline-flex rounded-xl border border-amber/20 bg-black/15 p-1" aria-label="Donation frequency">
                {(["ONE_TIME", "MONTHLY"] as const).map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    onClick={() => { setDonationFrequency(frequency); setIntent(null); setError(""); }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${donationFrequency === frequency ? "bg-amber text-bg-void" : "text-text-secondary hover:text-text-primary"}`}
                  >
                    {frequency === "MONTHLY" ? "Monthly" : "One time"}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">
              <span className={`h-1.5 w-1.5 rounded-full ${config.configured ? "bg-mint" : "bg-amber"}`} />
              {config.configured ? "Secure checkout · opens in browser" : "Currently unavailable"}
            </div>
          </div>
        </div>
        {config.checkoutUrl && (adminPreview || guestToken) ? (
          <a
            href={config.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openCheckout}
            aria-label="Support Piratezparty on Buy Me a Coffee (opens in browser)"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-amber px-5 py-3 text-sm font-bold text-bg-void transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:cursor-wait disabled:opacity-70 lg:min-h-0 lg:bg-transparent lg:p-0"
          >
            <Image src={`${BMC_ASSET_ROOT}/bmc-logo-no-background.png`} alt="" width={20} height={29} className="h-6 w-auto object-contain lg:hidden" />
            <span className="lg:hidden">Buy me a coffee</span>
            <Image src={`${BMC_ASSET_ROOT}/bmc-button.png`} alt="" width={218} height={61} className="hidden h-12 w-auto object-contain lg:block" />
          </a>
        ) : config.checkoutUrl ? (
          <button
            type="button"
            disabled={preparing}
            onClick={() => void prepareCheckout()}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-amber px-5 py-3 text-sm font-bold text-bg-void transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:cursor-wait disabled:opacity-70"
          >
            <Image src={`${BMC_ASSET_ROOT}/bmc-logo-no-background.png`} alt="" width={20} height={29} className="h-6 w-auto object-contain" />
            {preparing ? "Preparing secure reference..." : intent ? "Generate a new reference" : `Continue ${donationFrequency === "MONTHLY" ? "monthly" : "one time"}`}
          </button>
        ) : (
          <span className="shrink-0 rounded-full border border-amber/20 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-amber">Unavailable</span>
        )}
      </div>
      {intent && !adminPreview && !guestToken && (
        <div className="relative mt-5 rounded-2xl border border-amber/25 bg-black/20 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[.12em] text-amber">Required for automatic attribution</div>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                Copy this one-time reference and paste it into BMC&apos;s <strong className="text-text-primary">support note / “Say something nice”</strong> field before paying.
              </p>
              <p className="mt-2 text-xs leading-5 text-text-tertiary">
                {donationFrequency === "MONTHLY"
                  ? "On BMC, choose Monthly and enter your custom amount. The code is needed only on the first payment; signed future autopay webhooks use your verified BMC supporter ID and stay linked automatically."
                  : "On BMC, choose One time and enter your custom amount. If the code is missing, an admin can assign the payment from the donor list; that verified supporter ID is remembered for future payments."}
              </p>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="mt-3 flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-amber/25 bg-amber/[.07] px-4 py-3 text-left transition-colors hover:bg-amber/[.11]"
              >
                <code className="break-all font-mono text-sm font-bold tracking-[.08em] text-amber sm:text-base">{intent.code}</code>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[.08em] text-amber">{copied ? "Copied" : "Copy"}</span>
              </button>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[.08em] text-text-tertiary">
                Expires {new Date(intent.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · single use
              </p>
            </div>
            <a
              href={intent.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openCheckout}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-amber px-5 py-3 text-sm font-bold text-bg-void transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0"
            >
              Open Buy Me a Coffee
            </a>
          </div>
        </div>
      )}
      {error && <p className="relative mt-3 text-xs text-coral">{error}</p>}
    </section>
  );
}
