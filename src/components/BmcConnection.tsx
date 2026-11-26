"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import TransactionsNav from "./TransactionsNav";
import { displayDateTime } from "@/lib/date-format";

type Frame = { loginId: string; image: string; width: number; height: number; expiresAt: string; host: string };
type Payment = { id: string; amount: string; currency: string; occurredAt: string; frequency: string; refundStatus: string };
type Status = { connected: boolean; connectedAt: string | null; accountSlug: string; login: { id: string } | null;
  subscriptions: { id: string; stripeId: string; status: "ACTIVE" | "PAUSED" | "CANCELLING" | "CANCELLED"; cancelledAt: string | null; renewalAt: string | null; lastSeenAt?: string; missingFromLatestCheck?: boolean }[];
  health: { syncing: boolean; lastSuccessAt: string | null; lastAttemptAt?: string; error?: string; errorCode?: string; paymentCount: number; subscriptions: number; reviewCount: number };
  payments: Payment[]; reviews: { id: string; reason: string; transactionId?: string }[] };
const reasons: Record<string, string> = {
  AMBIGUOUS_MATCH: "More than one ledger entry could match this payment.", LEDGER_CONFLICT: "This payment has a rejected, voided or refunded ledger entry.",
  AMOUNT_OR_REFERENCE_MISMATCH: "The recorded amount, currency or payment reference differs.", DONOR_CONFLICT: "The donor link differs from the ledger entry.",
  DATE_OR_FREQUENCY_MISMATCH: "The recorded date or monthly/one-time classification differs from BMC’s paid history.",
  LEDGER_CHANGED_DURING_SYNC: "This ledger entry changed during verification. Run another check or review the entry.",
  LEDGER_PAYMENT_NOT_RETURNED: "A Sentinel payment entry has no matching charge in BMC’s returned paid history. Review the evidence before changing the payment or its XP award.",
  PROVIDER_REFUND_REQUIRES_REVIEW: "BMC reports a refund. Review the original payment before changing its award.",
  UNSUPPORTED_AMOUNT_OR_CURRENCY: "This amount or currency needs manual reconciliation.", POSSIBLE_EXISTING_PAYMENT: "An existing ledger entry may match. Review it to avoid a duplicate.",
  DONOR_OR_PAYMENT_REFERENCE_REQUIRED: "A verified donor link or payment reference is needed.", PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED: "BMC did not return a previously recorded payment. Its evidence has been retained for review.",
};
const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-bg-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime disabled:cursor-wait disabled:opacity-50";

export function BmcConnectionSkeleton() {
  return <div role="status" aria-label="Loading BMC connection" className="mx-auto max-w-5xl"><span className="sr-only">Loading BMC connection</span><div aria-hidden="true">
    <div className="skeleton mb-6 h-11 rounded-xl" /><div className="skeleton h-9 w-64 rounded-md" /><div className="skeleton mt-3 h-4 w-4/5 rounded-md" />
    <div className="mt-7 rounded-2xl border border-[var(--border)] p-6"><div className="skeleton h-6 w-40 rounded-md" /><div className="skeleton mt-4 h-4 w-3/4 rounded-md" /><div className="skeleton mt-6 h-11 w-48 rounded-xl" /></div>
    <div className="skeleton mt-10 h-6 w-48 rounded-md" />{[0, 1, 2].map(i => <div className="skeleton mt-4 h-16 rounded-xl" key={i} />)}
  </div></div>;
}
export default function BmcConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [showText, setShowText] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const response = await fetch("/api/bmc/connection", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "Could not load the BMC connection.");
    if (mounted.current) setStatus(body);
    return body as Status;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load().catch(reason => setError(reason.message));
    const timer = setInterval(() => { if (!pending.current) void load().catch(() => undefined); }, 10_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [load]);
  const refreshFrame = useCallback(async (id: string) => {
    const response = await fetch(`/api/bmc/connection?loginId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      if (["LOGIN_EXPIRED", "LOGIN_NAVIGATION_BLOCKED"].includes(body.code)) setFrame(null);
      throw Error(body.error || "Could not refresh the private browser.");
    }
    if (mounted.current) setFrame(body);
  }, []);
  useEffect(() => {
    const id = frame?.loginId;
    if (!id) return;
    const timer = setInterval(() => { if (!pending.current && document.visibilityState === "visible") void refreshFrame(id).catch(reason => setError(reason.message)); }, 2500);
    return () => clearInterval(timer);
  }, [frame?.loginId, refreshFrame]);
  async function action(action: string, extra: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/bmc/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, loginId: frame?.loginId, ...extra }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "The action could not complete. Try again.");
      if (body.image) setFrame(body);
      if (body.connected || body.cancelled || body.disconnected) { setFrame(null); setTyped(""); }
      if (body.connected) setNotice("BMC connected. Your first full history check is starting.");
      if (body.queued) setNotice("History check started. You can leave this page; Sentinel will finish it on the server.");
      if (body.disconnected) setNotice("BMC disconnected. Automatic history checks are paused.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The connection failed. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (!status) return error ? <div role="alert" className="p-5"><p>{error}</p><button className={`${button} mt-4`} onClick={() => { setError(""); void load().catch(reason => setError(reason.message)); }}>Retry connection</button></div> : <BmcConnectionSkeleton />;
  const needsReconnect = ["SESSION_EXPIRED", "PROVIDER_ACCESS_DENIED", "SESSION_NOT_CONFIGURED"].includes(status.health.errorCode || "");
  return <div className="mx-auto max-w-5xl">
    <TransactionsNav />
    <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">Buy Me a Coffee connection</h1>
    <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Connect <strong className="text-text-primary">{status.accountSlug}</strong> to verify payments and subscription status automatically.</p>
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}
    {notice && <p role="status" className="mt-5 rounded-xl border border-lime/25 bg-lime/5 p-4 text-sm text-text-primary">{notice}</p>}
    <section className="mt-7 rounded-2xl border border-[var(--border)] bg-bg-card p-5 sm:p-6" aria-labelledby="bmc-connection-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="bmc-connection-title" className="text-lg font-semibold">{needsReconnect ? "Reconnect BMC" : status.connected ? "Account connected" : "Connect your account"}</h2>
        <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${needsReconnect ? "bg-amber-400/10 text-amber-200" : status.connected ? "bg-lime/10 text-lime" : "bg-white/5 text-text-secondary"}`}>{needsReconnect ? "Action needed" : status.connected ? "Automatic checks on" : "Not connected"}</span>
      </div>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Sign in below from your phone or computer. Login opens in Incognito; Sentinel encrypts the saved session and does not save your password.</p>
      {status.health.error && <p className="mt-4 text-sm leading-relaxed text-amber-200">{status.health.error}</p>}
      {!frame && <div className="mt-6 flex flex-wrap gap-3">
        <button className="inline-flex items-center justify-center rounded-xl bg-lime font-semibold text-bg-deep transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime min-h-11 px-5 py-2.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void action("start")}>{busy ? "Please wait…" : status.connected || needsReconnect ? "Reconnect in Incognito" : "Open private login"}</button>
        {status.login && <button className={button} disabled={busy} onClick={() => void refreshFrame(status.login!.id).catch(reason => setError(reason.message))}>Resume private login</button>}
        {status.connected && <><button className={button} disabled={busy || status.health.syncing} onClick={() => void action("sync")}>{status.health.syncing ? "Checking history…" : "Check history now"}</button><button className={button} disabled={busy || status.health.syncing} onClick={() => void action("disconnect")}>Disconnect</button></>}
      </div>}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1"><dt className="text-text-tertiary">Last complete check</dt><dd className="mt-1 font-medium">{status.health.lastSuccessAt ? displayDateTime(status.health.lastSuccessAt) : "Waiting for first check"}</dd></div>
        <div><dt className="text-text-tertiary">Recorded payments</dt><dd className="mt-1 font-medium tabular-nums">{status.health.paymentCount}</dd></div>
        <div><dt className="text-text-tertiary">Needs review</dt><dd className="mt-1 font-medium tabular-nums">{status.health.reviewCount}</dd></div>
      </dl>
      <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-text-tertiary">Checks run every 15 minutes while the Sentinel bot is online. If BMC expires the session, admins receive a reconnect notification. Previous history stays available.</p>
    </section>
    {frame && <section className="mt-7" aria-labelledby="private-login-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold" id="private-login-title">Private BMC login</h2><button className={button} disabled={busy} onClick={() => void action("cancel")}>Close private window</button></div>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Use BMC’s email login. Tap a field in the browser, then enter its text below. Complete any OTP or verification yourself. When your dashboard opens, select <strong>Connect account</strong>. This private window closes after 15 minutes.</p>
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          <p className="border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-800">{frame.host} · Incognito</p>
          {/* Provider screenshot is generated only on the server, never a remote image URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frame.image} alt="Interactive private BMC login browser. Tap a field, then use the text and keyboard controls beside it." width={frame.width} height={frame.height} className="block h-auto w-full cursor-pointer" onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            void action("click", { x: Math.min(frame.width - 1, (event.clientX - bounds.left) * frame.width / bounds.width), y: Math.min(frame.height - 1, (event.clientY - bounds.top) * frame.height / bounds.height) });
          }} />
        </div>
        <div className="min-w-0">
          <form onSubmit={event => { event.preventDefault(); const text = typed; setTyped(""); void action("type", { text }); }}>
            <label className="text-sm font-semibold" htmlFor="bmc-login-text">Text for the selected BMC field</label>
            <p id="bmc-input-help" className="mt-2 text-xs leading-relaxed text-text-secondary">First tap the email, password or code field above. Text is hidden here and cleared after sending.</p>
            <input id="bmc-login-text" aria-describedby="bmc-input-help" type={showText ? "text" : "password"} autoComplete="off" maxLength={1000} value={typed} onChange={event => setTyped(event.target.value)} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--border)] bg-bg-card px-3 text-base focus:outline-2 focus:outline-lime" />
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={showText} onChange={event => setShowText(event.target.checked)} />Show entered text</label>
            <button type="submit" className={`${button} mt-2`} disabled={busy || !typed}>Send text to BMC</button>
          </form>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Private browser keyboard">
            {[["Tab", "Next field"], ["Shift+Tab", "Previous field"], ["Enter", "Enter"], ["Backspace", "Backspace"], ["ControlOrMeta+A", "Select field text"]].map(([key, label]) => <button key={key} className={button} disabled={busy} onClick={() => void action("key", { key })}>{label}</button>)}
            <button className={button} disabled={busy} onClick={() => void action("scroll", { dy: -450 })}>Scroll up</button><button className={button} disabled={busy} onClick={() => void action("scroll", { dy: 450 })}>Scroll down</button>
            <button className={button} disabled={busy} onClick={() => void refreshFrame(frame.loginId).catch(reason => setError(reason.message))}>Refresh view</button>
          </div>
          <button className="inline-flex items-center justify-center rounded-xl bg-lime font-semibold text-bg-deep transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime mt-7 min-h-11 w-full px-5 py-3 text-sm disabled:opacity-50" disabled={busy} onClick={() => void action("finish")}>{busy ? "Please wait…" : "Connect account"}</button>
          <p className="mt-3 text-xs leading-relaxed text-text-tertiary">Only the configured creator account can connect. Closing this window discards an unfinished login.</p>
        </div>
      </div>
    </section>}
    <section className="mt-10" aria-labelledby="bmc-subscriptions-title">
      <h2 id="bmc-subscriptions-title" className="text-xl font-semibold">Subscription status</h2>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Checked directly against BMC’s subscription records, separately from paid history. Cancelling monthly support does not reverse earlier successful payments.</p>
      {!status.subscriptions.length ? <p className="mt-5 text-sm text-text-tertiary">Subscription status will appear after the first complete check.</p> : <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">{status.subscriptions.map(subscription => <li key={subscription.id} className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Subscription {subscription.id}</h3><span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${subscription.missingFromLatestCheck ? "bg-amber-400/10 text-amber-200" : subscription.status === "ACTIVE" ? "bg-lime/10 text-lime" : subscription.status === "CANCELLED" ? "bg-white/5 text-text-secondary" : "bg-amber-400/10 text-amber-200"}`}>{subscription.missingFromLatestCheck ? "Status unavailable" : { ACTIVE: "Active", PAUSED: "Paused", CANCELLING: "Cancels at period end", CANCELLED: "Cancelled" }[subscription.status]}</span></div>
        {subscription.missingFromLatestCheck && <p className="mt-2 text-xs leading-relaxed text-amber-200">Not returned by the latest check. Last known status: {subscription.status.toLowerCase()}{subscription.lastSeenAt ? `, checked ${displayDateTime(subscription.lastSeenAt)}` : ""}. Review this subscription in BMC.</p>}
        {subscription.cancelledAt && <p className="mt-2 text-xs text-text-secondary">BMC cancellation time: {subscription.cancelledAt}</p>}
        {subscription.renewalAt && subscription.status === "ACTIVE" && !subscription.missingFromLatestCheck && <p className="mt-2 text-xs text-text-secondary">BMC scheduled renewal: {subscription.renewalAt}. Payment will be confirmed separately.</p>}
        <details className="mt-2 text-xs text-text-tertiary"><summary className="cursor-pointer">Provider reference</summary><code className="mt-2 block break-all">{subscription.stripeId}</code></details>
      </li>)}</ul>}
      {status.subscriptions.some(row => row.cancelledAt || row.renewalAt) && <p className="mt-3 text-xs text-text-tertiary">Lifecycle times are shown as returned by BMC; its response does not specify a timezone.</p>}
    </section>
    {status.reviews.length > 0 && <section id="bmc-review" className="mt-10 scroll-mt-24" aria-labelledby="bmc-review-title">
      <h2 id="bmc-review-title" className="text-xl font-semibold">Needs review</h2>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">These records need a decision. Verification has not automatically voided payments or removed awards.</p>
      <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">{status.reviews.map(review => <li key={`${review.id}:${review.reason}`} className="py-4">
        <p className="max-w-[70ch] text-sm leading-relaxed text-text-primary">{reasons[review.reason] || "This payment needs manual review."}</p>
        {review.transactionId && <Link className="mt-2 inline-flex min-h-11 items-center text-sm text-lime underline underline-offset-4" href={`/admin/transactions?transactionId=${encodeURIComponent(review.transactionId)}&lifecycle=ALL`}>Review ledger entry</Link>}
        <details className="mt-2 text-xs text-text-tertiary"><summary className="cursor-pointer">Review reference</summary><code className="mt-2 block break-all">{review.id}</code></details>
      </li>)}</ul>
    </section>}
    <section className="mt-10" aria-labelledby="bmc-history-title">
      <h2 id="bmc-history-title" className="text-xl font-semibold">Payment verification</h2>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Sentinel checks all available one-time and monthly support history, including cancelled subscriptions. Subscription activity alone does not confirm a payment. Ambiguous records and refunds go to review; missing history never automatically removes XP.</p>
      {!status.payments.length ? <p className="mt-5 rounded-xl border border-[var(--border)] p-5 text-sm text-text-secondary">{status.health.syncing ? "Fetching your full payment history…" : "Connect BMC and run a history check to see recorded payments here."}</p> : <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {status.payments.map(payment => {
          const reviews = status.reviews.filter(review => review.id === payment.id);
          return <li key={payment.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold tabular-nums">{new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency }).format(Number(payment.amount))}<span className="ml-2 text-xs font-normal text-text-secondary">{payment.frequency === "MONTHLY" ? "Monthly support" : "One-time support"}</span></p><time className="mt-1 block text-xs text-text-tertiary">{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(payment.occurredAt))}</time></div><span className={`text-xs font-medium ${reviews.length ? "text-amber-200" : "text-lime"}`}>{reviews.length ? "Needs review" : "Recorded in BMC"}</span></div>
            {reviews.length > 0 && <a className="mt-2 inline-flex min-h-11 items-center text-sm text-lime underline underline-offset-4" href="#bmc-review">View review details</a>}
            <details className="mt-3 text-xs text-text-tertiary"><summary className="cursor-pointer">Payment reference</summary><code className="mt-2 block break-all">{payment.id}</code></details>
          </li>;
        })}
      </ul>}
      {status.health.paymentCount > 30 && <p className="mt-4 text-xs text-text-tertiary">Showing the latest 30 of {status.health.paymentCount} recorded payments. The private history API includes the full history.</p>}
    </section>
  </div>;
}
