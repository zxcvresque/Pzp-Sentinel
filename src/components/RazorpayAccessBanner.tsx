"use client";

import Image from "next/image";
import { useState } from "react";

const ASSET_ROOT = "/Payment%20Apps%20Icons";
const METHODS = [
  ["google-pay-light.svg", "Google Pay"],
  ["PhonePe-Logo.wine.svg", "PhonePe"],
  ["Paytm-Logo.wine.svg", "Paytm"],
  ["amazon-pay-light.svg", "Amazon Pay"],
  ["visa-light.svg", "Visa"],
  ["mastercard-light.svg", "Mastercard"],
] as const;

export default function RazorpayAccessBanner({
  requested,
  onRequested,
}: {
  requested: boolean;
  onRequested: (requestedAt: string | null) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function requestAccess() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/payments/access", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not request Razorpay access");
      onRequested(data.access?.razorpayRequestedAt || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request Razorpay access");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="relative mb-6 overflow-hidden rounded-[22px] border border-sky-400/20 bg-[linear-gradient(135deg,rgba(51,149,255,.10),rgba(20,20,25,.96)_58%)] p-5 shadow-[0_20px_70px_rgba(0,0,0,.18)] sm:p-6">
      <div className="pointer-events-none absolute -right-8 -top-14 h-40 w-40 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-400/10">
              <Image src={`${ASSET_ROOT}/razorpay-logo-notext.png`} alt="Razorpay" width={22} height={22} className="h-[22px] w-[22px] object-contain" />
            </span>
            <h2 className="text-base font-bold text-text-primary">UPI &amp; Bank Methods are not enabled for your account yet</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-text-secondary">
            Request approval to pay inside Sentinel through Razorpay using UPI, cards, wallets, or netbanking. An administrator will be notified immediately.
          </p>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Payment methods available after approval">
            {METHODS.map(([src, alt]) => (
              <span key={src} className="grid h-9 w-14 place-items-center overflow-hidden rounded-lg border border-white/15 bg-white p-1 shadow-sm">
                <Image src={`${ASSET_ROOT}/${src}`} alt={alt} width={44} height={28} className="max-h-7 w-11 object-contain" />
              </span>
            ))}
          </div>
          {error && <p className="mt-3 text-xs text-coral">{error}</p>}
        </div>
        <button
          type="button"
          disabled={requested || submitting}
          onClick={() => void requestAccess()}
          className="min-h-11 shrink-0 rounded-full bg-sky-400 px-5 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-sky-300 disabled:cursor-default disabled:bg-mint/10 disabled:text-mint"
        >
          {requested ? "Approval requested" : submitting ? "Sending request..." : "Request Razorpay access"}
        </button>
      </div>
    </section>
  );
}
