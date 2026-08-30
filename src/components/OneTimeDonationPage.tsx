"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import RazorpayDonationCard from "@/components/RazorpayDonationCard";
import BmcSupportCard from "@/components/BmcSupportCard";

type Invite = {
  guestName: string;
  telegramUser: string | null;
  note: string | null;
  expiresAt: string;
  allowRazorpay: boolean;
  lockedRazorpayAmount: number | null;
  state: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
};

export default function OneTimeDonationPage({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    fetch(`/api/payments/razorpay/guest?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Payment link is unavailable");
        setInvite(data.invite);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Payment link is unavailable"))
      .finally(() => setLoading(false));
  }, [token]);

  const unavailable = invite && invite.state !== "ACTIVE";
  const stateText = invite?.state === "USED" ? "This payment link has already been used."
    : invite?.state === "EXPIRED" ? "This payment link has expired."
      : invite?.state === "REVOKED" ? "This payment link was revoked by an administrator."
        : "";

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-void px-4 py-6 text-text-primary sm:px-6 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-180px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-lime/8 blur-[100px]" />
      <div className="relative mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo-icon.webp" alt="Sentinel" width={36} height={36} className="h-9 w-9 rounded-xl" priority />
            <div><div className="text-sm font-extrabold tracking-[.16em]">SENTINEL</div><div className="font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">One-time donor checkout</div></div>
          </div>
          <span className="rounded-full border border-mint/20 bg-mint/8 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-mint">Telegram verified</span>
        </header>

        {loading ? (
          <div className="space-y-4"><div className="skeleton h-28 w-full" /><div className="skeleton h-96 w-full" /></div>
        ) : error || unavailable ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-[var(--border)] bg-bg-deep p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-coral/10 text-xl text-coral">!</div>
            <h1 className="text-xl font-bold">Link unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{error || stateText}</p>
          </section>
        ) : complete ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-mint/20 bg-bg-deep p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-mint/10 text-2xl text-mint">✓</div>
            <h1 className="text-2xl font-extrabold">Payment recorded</h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">Thank you, {invite?.guestName}. This one-time link is now closed and the verified donation is in Sentinel.</p>
          </section>
        ) : invite ? (
          <>
            <section className="mb-5 rounded-2xl border border-[var(--border)] bg-bg-deep/70 p-4 sm:flex sm:items-center sm:justify-between sm:p-5">
              <div><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Prepared for</p><h1 className="mt-1 text-xl font-extrabold">{invite.guestName}</h1>{invite.telegramUser && <p className="mt-1 text-xs text-text-secondary">@{invite.telegramUser}</p>}</div>
              <div className="mt-4 text-left sm:mt-0 sm:text-right"><p className="font-mono text-[9px] uppercase tracking-[.14em] text-text-tertiary">Valid until</p><p className="mt-1 text-sm text-text-secondary">{new Date(invite.expiresAt).toLocaleString()}</p></div>
            </section>
            <BmcSupportCard guestToken={token} />
            {invite.allowRazorpay && <RazorpayDonationCard guestToken={token} lockedGuestAmount={invite.lockedRazorpayAmount} onSuccess={() => setComplete(true)} />}
          </>
        ) : null}

        <footer className="mt-8 text-center font-mono text-[9px] uppercase tracking-[.1em] text-text-tertiary">Access is tied to the verified Telegram account and invitation expiry</footer>
      </div>
      <div className="grain" />
    </main>
  );
}
