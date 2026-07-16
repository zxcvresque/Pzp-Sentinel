"use client";

import { useState } from "react";
import Image from "next/image";

type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
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

function PaymentLogo({ file, alt }: { file: string; alt: string }) {
  return (
    <Image
      src={`${PAYMENT_ICON_ROOT}/${file}`}
      alt={alt}
      width={48}
      height={20}
      className="h-5 w-auto max-w-12 object-contain"
    />
  );
}

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
  const presets = [251, 501, 1001, 2501];

  async function beginPayment() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1_000_000) {
      setMessage({ type: "error", text: "Enter an amount between ₹1 and ₹10,00,000." });
      return;
    }
    setBusy(true);
    setMessage({ type: "info", text: "Preparing secure checkout…" });

    try {
      const [orderResponse] = await Promise.all([
        fetch(guestToken ? "/api/payments/razorpay/guest/orders" : "/api/payments/razorpay/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: parsed, description: note.trim() || undefined, token: guestToken }),
        }),
        loadCheckout(),
      ]);
      const orderData = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderData.error || "Could not create checkout");
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");

      const order = orderData.order as {
        id: string; amount: number; currency: string; description: string; keyId: string; testMode: boolean;
        prefill: { name: string };
      };
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Sentinel · PzP",
        description: order.description,
        image: `${window.location.origin}/logo-icon.webp`,
        order_id: order.id,
        prefill: order.prefill,
        notes: { source: adminPreview ? "admin_donors" : "donor_dashboard" },
        theme: { color: getComputedStyle(document.documentElement).getPropertyValue("--lime").trim() || "#6FD1D7" },
        retry: { enabled: true },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setBusy(false);
            setMessage({ type: "info", text: "Checkout closed. No donation was recorded." });
          },
        },
        handler: async (response: CheckoutSuccess) => {
          setMessage({ type: "info", text: "Verifying the captured payment…" });
          try {
            const verifyResponse = await fetch(guestToken ? "/api/payments/razorpay/guest/verify" : "/api/payments/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, token: guestToken }),
            });
            const verified = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verified.error || "Payment verification failed");
            setMessage({
              type: "success",
              text: order.testMode
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
      });
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
            <span className="rounded-full border border-violet/20 bg-violet/8 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-violet">Razorpay checkout</span>
          </div>
          <h2 className="max-w-xl text-xl font-extrabold leading-tight sm:text-2xl">
            Make a <span className="font-display text-lime">donation</span>{guestToken ? " securely" : " without leaving Sentinel"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">
            Choose an amount, then pay in Razorpay&apos;s protected checkout. Successful captures are verified server-side and added to Transactions automatically.
          </p>

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
            <span>{busy ? "Please wait…" : `Pay ₹${Number(amount || 0).toLocaleString("en-IN")}`}</span>
            {!busy && <span aria-hidden="true">→</span>}
          </button>

          {message && (
            <div role="status" className={`mt-3 rounded-xl border px-3.5 py-3 text-sm ${message.type === "success" ? "border-mint/20 bg-mint/8 text-mint" : message.type === "error" ? "border-coral/20 bg-coral/8 text-coral" : "border-cyan/20 bg-cyan/8 text-cyan"}`}>
              {message.text}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-lime/20 bg-lime/8 text-lime"><QrGlyph /></div>
            <div><p className="text-sm font-semibold">One checkout, your choice</p><p className="mt-0.5 text-xs text-text-tertiary">Methods depend on Razorpay account settings</p></div>
          </div>
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 p-3.5">
            <p className="mb-3 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Popular payment examples</p>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { file: "Google_Pay-Logo.wine.svg", alt: "Google Pay" },
                { file: "PhonePe-Logo.wine.svg", alt: "PhonePe" },
                { file: "Paytm-Logo.wine.svg", alt: "Paytm" },
                { file: "MobiKwik-Logo.wine.svg", alt: "MobiKwik" },
              ].map((method) => (
                <span key={method.file} className="flex h-9 min-w-14 items-center justify-center rounded-xl border border-white/[.07] bg-white/[.025] px-2.5">
                  <PaymentLogo file={method.file} alt={method.alt} />
                </span>
              ))}
              <span className="flex h-9 items-center rounded-xl border border-white/[.07] bg-white/[.025] px-2.5">
                <Image src={`${PAYMENT_ICON_ROOT}/cards.webp`} alt="Visa, Mastercard and American Express" width={108} height={27} className="h-5 w-auto object-contain" />
              </span>
              <span className="flex h-9 items-center rounded-xl border border-lime/15 bg-lime/5 px-3 text-[10px] font-semibold text-lime">and more…</span>
            </div>
          </div>
          <div className="mt-4 border-t border-[var(--border)] pt-4 text-[11px] leading-5 text-text-tertiary">
            Checkout shows only the methods enabled on your Razorpay account and supported on the payer&apos;s device.
          </div>
        </div>
      </div>
    </section>
  );
}
