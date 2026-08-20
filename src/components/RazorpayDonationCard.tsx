"use client";

import { useState } from "react";
import Image from "next/image";
import { RAZORPAY_CHECKOUT_TIMEOUT_SECONDS } from "@/lib/razorpay-checkout";

type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
};

type CheckoutFailure = { error?: { description?: string } };

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", callback: (response: CheckoutFailure) => void) => void;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

let checkoutLoader: Promise<void> | null = null;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutLoader) return checkoutLoader;
  checkoutLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Razorpay Checkout could not load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay Checkout could not load"));
    document.head.appendChild(script);
  });
  return checkoutLoader;
}

function QrGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" /><rect x="17.5" y="2.5" width="8" height="8" rx="1.5" />
      <rect x="2.5" y="17.5" width="8" height="8" rx="1.5" /><path d="M15 15h4v4h-4zM21 15h4M25 15v5M15 21v4h4M21 22h4v4" />
    </svg>
  );
}

const PAYMENT_ICON_ROOT = "/Payment%20Apps%20Icons";

function PaymentLogo({ file, alt, wordmark = false }: { file: string; alt: string; wordmark?: boolean }) {
  return (
    <span className="grid h-9 w-[68px] shrink-0 place-items-center overflow-hidden rounded-lg border border-white/70 bg-[#f7f8fb] shadow-[0_3px_12px_rgba(0,0,0,.24)] sm:h-10 sm:w-[72px]">
      <Image
        src={`${PAYMENT_ICON_ROOT}/${file}`}
        alt={alt}
        width={wordmark ? 112 : 60}
        height={wordmark ? 34 : 40}
        className={wordmark ? "h-7 w-[64px] object-contain sm:h-8 sm:w-[68px]" : "h-full w-auto object-contain"}
      />
    </span>
  );
}

const PAYMENT_METHODS = [
  { file: "amazon-pay-light.svg", alt: "Amazon Pay", label: "Amazon Pay", wordmark: false, compactLabel: false },
  { file: "PhonePe-Logo.wine.svg", alt: "PhonePe", label: "PhonePe", wordmark: true, compactLabel: false },
  { file: "google-pay-light.svg", alt: "Google Pay", label: "Google Pay", wordmark: false, compactLabel: false },
  { file: "Paytm-Logo.wine.svg", alt: "Paytm", label: "Paytm", wordmark: true, compactLabel: false },
  { file: "MobiKwik-Logo.wine.svg", alt: "MobiKwik", label: "MobiKwik", wordmark: true, compactLabel: false },
  { file: "apple-pay-light.svg", alt: "Apple Pay", label: "Apple Pay", wordmark: false, compactLabel: false },
  { file: "samsung-pay-light.svg", alt: "Samsung Pay", label: "Samsung Pay", wordmark: false, compactLabel: false },
  { file: "mastercard-light.svg", alt: "Mastercard", label: "Mastercard", wordmark: false, compactLabel: true },
  { file: "visa-light.svg", alt: "Visa", label: "Visa", wordmark: false, compactLabel: false },
  { file: "amex-light.svg", alt: "American Express", label: "Amex", wordmark: false, compactLabel: false },
] as const;

export default function RazorpayDonationCard({
  onSuccess,
  adminPreview = false,
  guestToken,
}: {
  onSuccess?: () => void | Promise<void>;
  adminPreview?: boolean;
  guestToken?: string;
}) {
  const [amount, setAmount] = useState("501");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [donationFrequency, setDonationFrequency] = useState<"ONE_TIME" | "MONTHLY">("ONE_TIME");
  const presets = [251, 501, 1001, 2501];

  async function beginPayment() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1_000_000) {
      setMessage({ type: "error", text: "Enter an amount between ₹1 and ₹10,00,000." });
      return;
    }
    const monthly = donationFrequency === "MONTHLY" && !guestToken;
    setBusy(true);
    setMessage({ type: "info", text: "Preparing secure checkout…" });

    try {
      const createUrl = monthly
        ? "/api/payments/razorpay/subscriptions"
        : guestToken ? "/api/payments/razorpay/guest/orders" : "/api/payments/razorpay/orders";
      const [orderResponse] = await Promise.all([
        fetch(createUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: parsed, description: note.trim() || undefined, token: guestToken }),
        }),
        loadCheckout(),
      ]);
      const orderData = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderData.error || "Could not create checkout");

      const order = (monthly ? orderData.subscription : orderData.order) as {
        id: string; amount: number; currency: string; description: string; keyId: string; testMode: boolean;
        prefill: { name: string };
      };
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");
      const checkoutOptions: Record<string, unknown> = {
        key: order.keyId,
        currency: order.currency,
        name: "Sentinel · PzP",
        description: order.description,
        image: `${window.location.origin}/logo-icon.webp`,
        prefill: order.prefill,
        notes: {
          source: adminPreview ? "admin_donors" : "donor_dashboard",
          donation_frequency: monthly ? "monthly" : "one_time",
        },
        theme: { color: getComputedStyle(document.documentElement).getPropertyValue("--lime").trim() || "#6FD1D7" },
        retry: { enabled: true },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setBusy(false);
            setMessage({
              type: "info",
              text: monthly
                ? "Checkout closed or expired. Start monthly autopay again to generate a fresh mandate and QR."
                : "Checkout closed. No donation was recorded.",
            });
          },
        },
        handler: async (response: CheckoutSuccess) => {
          setMessage({ type: "info", text: "Verifying the captured payment…" });
          try {
            const verifyUrl = monthly
              ? "/api/payments/razorpay/subscriptions/verify"
              : guestToken ? "/api/payments/razorpay/guest/verify" : "/api/payments/razorpay/verify";
            const verifyResponse = await fetch(verifyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, token: guestToken }),
            });
            const verified = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verified.error || "Payment verification failed");
            setMessage({
              type: "success",
              text: monthly
                ? verified.paymentRecorded
                  ? "Monthly autopay authorised. Your first payment was received, recorded and notified; future successful charges will be tracked automatically."
                  : "Monthly autopay authorised. Razorpay will charge this amount each month and Sentinel will track each successful charge automatically."
                : order.testMode
                  ? "Test payment verified and tracked. It is excluded from real finance totals."
                  : "Payment received and tracked automatically. Thank you!",
            });
            await onSuccess?.();
          } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "Payment verification failed" });
          } finally {
            setBusy(false);
          }
        },
      };
      if (monthly) {
        checkoutOptions.subscription_id = order.id;
        checkoutOptions.timeout = RAZORPAY_CHECKOUT_TIMEOUT_SECONDS;
      } else {
        checkoutOptions.amount = order.amount;
        checkoutOptions.order_id = order.id;
      }
      const checkout = new window.Razorpay(checkoutOptions);
      checkout.on("payment.failed", (response) => {
        setBusy(false);
        setMessage({ type: "error", text: response.error?.description || "The payment failed. Please try again." });
      });
      setMessage(null);
      checkout.open();
    } catch (error) {
      setBusy(false);
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not open checkout" });
    }
  }

  return (
    <section data-tour="razorpay-donation" className="relative mb-6 overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--bg-deep)] p-4 shadow-[0_20px_70px_rgba(0,0,0,.22)] sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lime/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-14 h-48 w-48 rounded-full bg-violet/8 blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)] lg:items-center">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-lime/20 bg-lime/8 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-lime">Secure checkout</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#3395ff]/25 bg-[#3395ff]/10 shadow-[0_5px_20px_rgba(51,149,255,.12)]">
              <Image src={`${PAYMENT_ICON_ROOT}/razorpay-logo-notext.png`} alt="Razorpay checkout" width={21} height={21} className="h-[21px] w-[21px] object-contain" priority />
            </span>
          </div>
          <h2 className="max-w-xl text-xl font-extrabold leading-tight sm:text-2xl">
            Make a <span className="font-display text-lime">donation</span> securely
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">
            Choose one time or monthly, enter any amount, and complete checkout securely with Razorpay.
          </p>

          {!guestToken && (
            <div className="mt-4 inline-flex rounded-xl border border-[var(--border)] bg-black/15 p-1" aria-label="Donation frequency">
              {(["ONE_TIME", "MONTHLY"] as const).map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  onClick={() => { setDonationFrequency(frequency); setMessage(null); }}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${donationFrequency === frequency ? "bg-lime text-bg-void" : "text-text-secondary hover:text-text-primary"}`}
                >
                  {frequency === "MONTHLY" ? "Monthly autopay" : "One time"}
                </button>
              ))}
            </div>
          )}
          {donationFrequency === "MONTHLY" && !guestToken && (
            <p className="mt-2 text-xs leading-5 text-text-tertiary">
              Razorpay will ask you to authorise a five-year mandate here, then automatically charge the chosen amount every month.
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((preset) => (
              <button key={preset} type="button" onClick={() => setAmount(String(preset))}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${amount === String(preset) ? "border-lime/40 bg-lime/12 text-lime shadow-[0_0_24px_var(--lime-glow)]" : "border-[var(--border)] bg-white/[.02] text-text-secondary hover:border-[var(--border-hover)] hover:text-text-primary"}`}>
                ₹{preset.toLocaleString("en-IN")}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,170px)_1fr]">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Custom amount</span>
              <span className="flex h-12 items-center rounded-xl border border-[var(--border)] bg-black/10 px-3 focus-within:border-[var(--border-active)]">
                <span className="mr-2 text-text-secondary">₹</span>
                <input aria-label="Donation amount" type="text" inputMode="decimal" value={amount}
                  onChange={(event) => /^\d*\.?\d{0,2}$/.test(event.target.value) && setAmount(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold text-text-primary outline-none" placeholder="501" />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Note (optional)</span>
              <input aria-label="Donation note" value={note} maxLength={120} onChange={(event) => setNote(event.target.value)}
                className="h-12 w-full rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-[var(--border-active)]" placeholder="Monthly contribution" />
            </label>
          </div>

          <button type="button" onClick={beginPayment} disabled={busy || !amount}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-lime px-5 py-3 text-sm font-bold text-bg-void shadow-[0_10px_30px_var(--lime-glow)] transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-52">
            <span>{busy ? "Please wait…" : donationFrequency === "MONTHLY" && !guestToken ? `Authorise ₹${Number(amount || 0).toLocaleString("en-IN")} monthly` : `Pay ₹${Number(amount || 0).toLocaleString("en-IN")}`}</span>
            {!busy && <span aria-hidden="true">→</span>}
          </button>

          {message && (
            <div role="status" className={`mt-3 rounded-xl border px-3.5 py-3 text-sm ${message.type === "success" ? "border-mint/20 bg-mint/8 text-mint" : message.type === "error" ? "border-coral/20 bg-coral/8 text-coral" : "border-cyan/20 bg-cyan/8 text-cyan"}`}>
              {message.text}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-lime/20 bg-lime/8 text-lime"><QrGlyph /></div>
            <div><p className="text-sm font-semibold">One checkout, your choice</p><p className="mt-0.5 text-xs text-text-tertiary">One time or monthly autopay</p></div>
          </div>
          <div className="mt-3 rounded-2xl border border-[var(--border)] bg-black/15 p-3">
            <p className="mb-3 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Popular payment methods</p>
            <div className="grid grid-cols-1 gap-1.5 min-[430px]:grid-cols-2">
              {PAYMENT_METHODS.map((method) => (
                <span key={method.file} className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-white/[.09] bg-white/[.035] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] sm:min-h-13 sm:px-2.5">
                  <PaymentLogo file={method.file} alt={method.alt} wordmark={method.wordmark} />
                  <span className={`min-w-0 break-words font-medium leading-tight text-text-secondary ${method.compactLabel ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]"}`}>{method.label}</span>
                </span>
              ))}
              <span className="flex min-h-10 items-center justify-center rounded-xl border border-lime/20 bg-lime/[.07] px-3 text-[10px] font-semibold text-lime min-[430px]:col-span-2">and more…</span>
            </div>
          </div>
          <div className="mt-4 border-t border-[var(--border)] pt-4 text-[11px] leading-5 text-text-tertiary">
            Payments are processed securely by Razorpay.
          </div>
        </div>
      </div>
    </section>
  );
}
