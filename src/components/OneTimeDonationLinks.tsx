"use client";

import { useCallback, useState } from "react";

type Invite = {
  id: string;
  guestName: string;
  telegramUser: string | null;
  telegramId: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  order?: { status: string; transactionId: string | null; amount: number; testMode: boolean } | null;
};

type TelegramLookup = {
  found: boolean;
  user?: { name: string; telegramId: string; telegramUser: string };
  error?: string;
};

function inviteState(invite: Invite) {
  if (invite.revokedAt) return "Revoked";
  if (invite.usedAt || invite.order?.transactionId) return "Used";
  if (new Date(invite.expiresAt) <= new Date()) return "Expired";
  return invite.order ? "Checkout started" : "Ready";
}

export default function OneTimeDonationLinks() {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [telegramUser, setTelegramUser] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [note, setNote] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [createdUrl, setCreatedUrl] = useState("");
  const [message, setMessage] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [lookupFound, setLookupFound] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/payments/razorpay/invites", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setInvites(data.invites || []);
  }, []);

  async function resolveUsername(value = telegramUser) {
    const username = value.trim().replace(/^@/, "");
    if (!username) return "";

    setResolving(true);
    setLookupMessage("");
    setLookupFound(false);
    try {
      const response = await fetch(`/api/users/resolve-telegram?username=${encodeURIComponent(username)}`, { cache: "no-store" });
      const data = await response.json() as TelegramLookup;
      if (!response.ok) throw new Error(data.error || "Could not check this username");
      if (!data.found || !data.user) {
        setLookupMessage("Not registered in Sentinel — enter the numeric ID manually.");
        return "";
      }

      setTelegramUser(data.user.telegramUser || username);
      setTelegramId(data.user.telegramId);
      setLookupFound(true);
      setLookupMessage(`Matched ${data.user.name} · ID ${data.user.telegramId}`);
      return data.user.telegramId;
    } catch (error) {
      setLookupMessage(error instanceof Error ? error.message : "Could not check this username");
      return "";
    } finally {
      setResolving(false);
    }
  }

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setCreatedUrl("");
    try {
      let finalTelegramId = telegramId;
      if (!finalTelegramId && telegramUser) finalTelegramId = await resolveUsername();
      if (!/^\d{5,20}$/.test(finalTelegramId)) {
        throw new Error("Enter a valid Telegram numeric ID. A registered username can fill it automatically.");
      }

      const response = await fetch("/api/payments/razorpay/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, telegramUser, telegramId: finalTelegramId, note, expiresInHours }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create link");
      setCreatedUrl(data.paymentUrl);
      setGuestName("");
      setTelegramUser("");
      setTelegramId("");
      setNote("");
      setLookupMessage("");
      setLookupFound(false);
      setMessage("Single-use link created. Copy it now—the secret token is not shown again.");
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
    await navigator.clipboard.writeText(createdUrl);
    setMessage("Link copied. Send it privately to the intended Telegram user.");
  }

  return (
    <section className="mb-8 overflow-hidden rounded-[20px] border border-[var(--border)] bg-bg-deep">
      <button type="button" onClick={() => { if (!open) void load(); setOpen((value) => !value); }} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet/20 bg-violet/8 text-violet">
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 10h6M10 7v6"/><rect x="2.5" y="3" width="15" height="14" rx="3"/><path d="M6 3V1.8M14 3V1.8"/></svg>
          </div>
          <div><h2 className="text-sm font-semibold sm:text-base">One-time guest payment links</h2><p className="mt-0.5 text-xs text-text-tertiary">Limited checkout access tied to a mandatory Telegram ID</p></div>
        </div>
        <span className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {open && (
        <div className="animate-fade-in border-t border-[var(--border)] p-4 sm:p-5">
          <form onSubmit={createLink} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Guest name</span>
              <input required value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name"
                className="h-11 w-full rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)]" />
            </label>
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Telegram username <span className="opacity-60">optional</span></span>
              <input value={telegramUser} onChange={(event) => { setTelegramUser(event.target.value); setLookupMessage(""); setLookupFound(false); }} onBlur={() => void resolveUsername()} placeholder="@username (optional)"
                className="h-11 w-full rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)]" />
            </label>
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Telegram numeric ID <span className="text-coral">required</span></span>
              <input aria-required="true" inputMode="numeric" value={telegramId} onChange={(event) => /^\d*$/.test(event.target.value) && setTelegramId(event.target.value)} placeholder={resolving ? "Looking up ID…" : "Numeric ID"}
                className={`h-11 w-full rounded-xl border bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)] ${lookupFound ? "border-mint/40" : "border-[var(--border)]"}`} />
            </label>
            <label className="space-y-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[.11em] text-text-tertiary">Link expiry</span>
              <select value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--border)] bg-bg-deep px-3 text-sm outline-none focus:border-[var(--border-active)]">
                <option value="1">Expires in 1 hour</option><option value="24">Expires in 24 hours</option><option value="72">Expires in 3 days</option><option value="168">Expires in 7 days</option>
              </select>
            </label>
            <div className="flex items-end">
              <button disabled={loading || !guestName || (!telegramId && !telegramUser)} className="h-11 w-full rounded-xl bg-violet px-4 text-sm font-bold text-bg-void transition hover:brightness-105 disabled:opacity-40">{loading ? "Creating…" : resolving ? "Finding ID…" : "Create secure link"}</button>
            </div>
            {lookupMessage && <p className={`text-[10px] leading-4 sm:col-span-2 lg:col-span-5 ${lookupFound ? "text-mint" : "text-amber"}`}>{lookupMessage}</p>}
            <input value={note} maxLength={120} onChange={(event) => setNote(event.target.value)} placeholder="Payment note (optional)" className="h-11 rounded-xl border border-[var(--border)] bg-black/10 px-3 text-sm outline-none focus:border-[var(--border-active)] sm:col-span-2 lg:col-span-5" />
          </form>

          {createdUrl && (
            <div className="mt-4 rounded-xl border border-mint/20 bg-mint/8 p-3 sm:flex sm:items-center sm:gap-3">
              <code className="block min-w-0 flex-1 truncate text-xs text-mint">{createdUrl}</code>
              <button type="button" onClick={copyLink} className="mt-2 rounded-lg bg-mint px-3 py-2 text-xs font-bold text-bg-void sm:mt-0">Copy private link</button>
            </div>
          )}
          {message && <p className="mt-3 text-xs text-text-secondary">{message}</p>}

          {invites.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[.12em] text-text-tertiary">Recent links</p>
              {invites.slice(0, 8).map((invite) => {
                const state = inviteState(invite);
                const active = state === "Ready" || state === "Checkout started";
                return <div key={invite.id} className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><div className="truncate text-sm font-medium">{invite.guestName}{invite.telegramUser && <span className="font-normal text-text-tertiary"> @{invite.telegramUser}</span>}</div><div className="mt-1 font-mono text-[9px] text-text-tertiary">TG {invite.telegramId} · expires {new Date(invite.expiresAt).toLocaleString()}</div></div>
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
