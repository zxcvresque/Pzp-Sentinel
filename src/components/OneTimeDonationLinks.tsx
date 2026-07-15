"use client";

import { useCallback, useState } from "react";

type Invite = {
  id: string;
  guestName: string;
  telegramUser: string | null;
  telegramId: string | null;
  claimedAt: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  allowRazorpay: boolean;
  order?: { status: string; transactionId: string | null; amount: number; testMode: boolean } | null;
};

function inviteState(invite: Invite) {
  if (invite.revokedAt) return "Revoked";
  if (invite.usedAt || invite.order?.transactionId) return "Used";
  if (new Date(invite.expiresAt) <= new Date()) return "Expired";
  if (!invite.telegramId) return "Awaiting claim";
  return invite.order ? "Checkout started" : "Identity verified";
}

export default function OneTimeDonationLinks() {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [note, setNote] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [allowRazorpay, setAllowRazorpay] = useState(false);
  const [createdBotLink, setCreatedBotLink] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/payments/razorpay/invites", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setInvites(data.invites || []);
  }, []);

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setCreatedBotLink("");
    try {
      const response = await fetch("/api/payments/razorpay/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, note, expiresInHours, allowRazorpay }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create link");
      setCreatedBotLink(data.botLink);
      setGuestName("");
      setNote("");
      setAllowRazorpay(false);
      setMessage("Bot verification link created. Send it privately to the intended payer.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create link");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    const response = await fetch("/api/payments/razorpay/invites", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (response.ok) await load();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(createdBotLink);
    setMessage("Bot link copied. Telegram will verify the recipient before showing checkout.");
  }

  return (
    <section data-tour="guest-payment-links" className="mb-8 overflow-hidden rounded-[20px] border border-[var(--border)] bg-bg-deep">
      <button type="button" onClick={() => { if (!open) void load(); setOpen((value) => !value); }} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet/20 bg-violet/8 text-violet">
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 10h6M10 7v6"/><rect x="2.5" y="3" width="15" height="14" rx="3"/><path d="M6 3V1.8M14 3V1.8"/></svg>
          </div>
          <div><h2 className="text-sm font-semibold sm:text-base">One-time guest payment links</h2><p className="mt-0.5 text-xs text-text-tertiary">Telegram verifies the payer before revealing checkout</p></div>
        </div>
        <span className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {open && (
        <div className="animate-fade-in border-t border-[var(--border)] p-4 sm:p-5">
          <div className="mb-4 rounded-xl border border-violet/15 bg-violet/5 px-3 py-2.5 text-xs leading-5 text-text-secondary">
            The recipient opens the generated bot link and taps <b className="text-text-primary">Start</b>. Telegram supplies their numeric ID and optional username; only then does the bot return the verified Sentinel payment options.
          </div>

          <form onSubmit={createLink} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_auto_auto]">
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Payer label or name</span>
              <input required value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Name shown in checkout"
                className="h-11 w-full rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)]" />
            </label>
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Bot link expiry</span>
              <select value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--border)] bg-bg-deep px-3 text-sm outline-none focus:border-[var(--border-active)]">
                <option value="1">Expires in 1 hour</option><option value="24">Expires in 24 hours</option><option value="72">Expires in 3 days</option><option value="168">Expires in 7 days</option>
              </select>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end rounded-xl border border-lime/20 bg-lime/5 px-3 text-xs text-text-secondary">
              <input type="checkbox" checked={allowRazorpay} onChange={(event) => setAllowRazorpay(event.target.checked)} className="h-4 w-4 accent-lime" />
              Also allow Razorpay
            </label>
            <div className="flex items-end">
              <button disabled={loading || !guestName.trim()} className="h-11 w-full rounded-xl bg-violet px-5 text-sm font-bold text-bg-void transition hover:brightness-105 disabled:opacity-40 lg:w-auto">{loading ? "Creating…" : "Create bot link"}</button>
            </div>
            <input value={note} maxLength={120} onChange={(event) => setNote(event.target.value)} placeholder="Payment note (optional)" className="h-11 rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)] sm:col-span-2 lg:col-span-4" />
          </form>

          {createdBotLink && (
            <div className="mt-4 rounded-xl border border-mint/20 bg-mint/8 p-3 sm:flex sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1"><p className="mb-1 font-mono text-[9px] uppercase tracking-[.1em] text-mint">Telegram verification link</p><code className="block truncate text-xs text-mint">{createdBotLink}</code></div>
              <button type="button" onClick={copyLink} className="mt-2 rounded-lg bg-mint px-3 py-2 text-xs font-bold text-bg-void sm:mt-0">Copy bot link</button>
            </div>
          )}
          {message && <p className="mt-3 text-xs text-text-secondary">{message}</p>}

          {invites.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Recent links</p>
              {invites.slice(0, 8).map((invite) => {
                const state = inviteState(invite);
                const active = state === "Awaiting claim" || state === "Identity verified" || state === "Checkout started";
                return <div key={invite.id} className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><div className="truncate text-sm font-medium">{invite.guestName}{invite.telegramUser && <span className="font-normal text-text-tertiary"> @{invite.telegramUser}</span>}</div><div className="mt-1 font-mono text-[9px] text-text-tertiary">{invite.telegramId ? `TG ${invite.telegramId} · ` : "Identity pending · "}{invite.allowRazorpay ? "BMC + Razorpay" : "BMC"} · expires {new Date(invite.expiresAt).toLocaleString()}</div></div>
                  <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase ${state === "Used" ? "bg-mint/10 text-mint" : active ? "bg-amber/10 text-amber" : "bg-coral/10 text-coral"}`}>{state}</span>{active && <button type="button" onClick={() => revoke(invite.id)} className="rounded-full border border-coral/20 px-2.5 py-1 text-[10px] text-coral">Revoke</button>}</div>
                </div>;
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
