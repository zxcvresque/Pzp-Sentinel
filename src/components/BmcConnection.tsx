"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import TransactionsNav from "./TransactionsNav";
import { displayDateTime } from "@/lib/date-format";

type Payment = { id: string; amount: string; currency: string; occurredAt: string; frequency: string; refundStatus: string };
type Status = { connected: boolean; connectedAt: string | null; accountSlug: string;
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
  const [appHeaders, setAppHeaders] = useState("");
  const [studioHeaders, setStudioHeaders] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [manualImport, setManualImport] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) feedbackRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [error]);
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
  async function action(action: string, extra: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setActiveAction(action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/bmc/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(75000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {

        throw Error(body?.error || "The server could not update the BMC session. Try again.");
      }
      if (body.connected) { setAppHeaders(""); setStudioHeaders(""); setSessionToken(""); setEditing(false); setShowSession(false); }
      if (body.connected) setNotice("BMC session verified and saved. Your full history check is starting.");
      if (body.queued) setNotice("History check started. You can leave this page; Sentinel will finish it on the server.");
      if (body.disconnected) setNotice("BMC disconnected. Automatic history checks are paused.");
      await load();
    } catch (reason) { setError(reason instanceof Error && ["TimeoutError", "AbortError"].includes(reason.name) ? "BMC session validation took too long. Try again; your existing session stays saved." : reason instanceof Error ? reason.message : "The connection failed. Try again."); }
    finally { pending.current = false; setBusy(false); setActiveAction(""); }
  }
  if (!status) return error ? <div role="alert" className="p-5"><p>{error}</p><button className={`${button} mt-4`} onClick={() => { setError(""); void load().catch(reason => setError(reason.message)); }}>Retry connection</button></div> : <BmcConnectionSkeleton />;
  const needsReconnect = ["SESSION_EXPIRED", "PROVIDER_ACCESS_DENIED", "SESSION_NOT_CONFIGURED"].includes(status.health.errorCode || "");
  return <div className="mx-auto max-w-5xl">
    <TransactionsNav />
    <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">Buy Me a Coffee connection</h1>
    <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Connect <strong className="text-text-primary">{status.accountSlug}</strong> to verify payments and subscription status automatically.</p>
    {notice && <p role="status" className="mt-5 rounded-xl border border-lime/25 bg-lime/5 p-4 text-sm text-text-primary">{notice}</p>}
    <section className="mt-7 rounded-2xl border border-[var(--border)] bg-bg-card p-5 sm:p-6" aria-labelledby="bmc-connection-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="bmc-connection-title" className="text-lg font-semibold">{needsReconnect ? "Update BMC session" : status.connected ? "Account connected" : "Import your session"}</h2>
        <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${needsReconnect ? "bg-amber-400/10 text-amber-200" : status.connected ? "bg-lime/10 text-lime" : "bg-white/5 text-text-secondary"}`}>{needsReconnect ? "Action needed" : status.connected ? "Automatic checks on" : "Not connected"}</span>
      </div>
      <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-text-secondary">Import your signed-in BMC session from Helium. Sentinel encrypts it on the server and uses it for automatic history checks. Update it here whenever BMC expires the session.</p>
      {status.health.error && <p className="mt-4 text-sm leading-relaxed text-amber-200">{status.health.error}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-lime px-5 py-2.5 text-sm font-semibold text-bg-deep hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime disabled:opacity-50" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? "Close session form" : status.connected || needsReconnect ? "Update Helium session" : "Import Helium session"}</button>
        {status.connected && <><button className={button} disabled={busy || status.health.syncing} onClick={() => void action("sync")}>{status.health.syncing ? "Checking history…" : "Check history now"}</button><button className={button} disabled={busy || status.health.syncing} onClick={() => void action("disconnect")}>Disconnect</button></>}
      </div>
      {editing && <form className="mt-6 grid gap-4 border-t border-[var(--border)] pt-6" onSubmit={event => { event.preventDefault(); void action("import", manualImport ? { appHeaders, studioHeaders } : { sessionToken }); }}>
        <h3 className="text-base font-semibold">Paste your Helium session</h3>
        <p className="max-w-[70ch] text-sm leading-relaxed text-text-secondary">Sign in to BMC in Helium, copy your session with the extractor, and paste it here. Sentinel verifies the creator account and history access before replacing the saved session.</p>
        <details className="text-sm leading-relaxed text-text-secondary">
          <summary className="min-h-11 cursor-pointer font-medium text-lime">Set up the Helium session extractor</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li><a href="/downloads/helium-bmc-session-extractor.zip" download className="text-lime underline underline-offset-4">Download the extractor</a> and unzip it.</li>
            <li>In Helium, open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>, select <strong>Load unpacked</strong>, and choose the extracted folder containing <code>manifest.json</code>. Review the BMC cookie-access permission.</li>
            <li>Open your signed-in BMC creator dashboard. Open the extractor and press <strong>Copy session for Sentinel</strong>, then paste below. If using an Incognito BMC window, enable <strong>Allow in Incognito</strong> for the extractor first.</li>
          </ol>
          <p className="mt-3">The extractor reads BMC cookies only when you press Copy. It has no background worker, saved data or network requests. A console snippet cannot read protected HttpOnly session cookies.</p>
        </details>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={manualImport} onChange={event => setManualImport(event.target.checked)} disabled={busy} />Use copied request headers instead</label>
        {!manualImport && <label htmlFor="bmc-session-token" className="grid gap-2 text-sm font-semibold">Helium session
          <textarea id="bmc-session-token" required rows={5} maxLength={65536} value={sessionToken} onChange={event => setSessionToken(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} className={`w-full resize-y rounded-xl border border-[var(--border)] bg-bg-deep p-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-lime ${showSession ? "" : "[-webkit-text-security:disc]"}`} />
        </label>}
        {manualImport && <><details className="text-sm leading-relaxed text-text-secondary">
          <summary className="min-h-11 cursor-pointer font-medium text-lime">How to copy the session from Helium</summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li>Open BMC’s creator dashboard in Helium. Open DevTools with <kbd>⌘⌥I</kbd> on Mac or <kbd>Ctrl+Shift+I</kbd> on Windows, then select <strong>Network</strong>.</li>
            <li>Open <strong>Supporters → Monthly</strong>. Select a successful request to <code className="break-all">app.buymeacoffee.com/api/v1/subscriptions?type=2…</code>. In <strong>Headers → Request Headers</strong>, copy the request headers, including <strong>Cookie</strong> and <strong>X-XSRF-TOKEN</strong> if present. Paste into the first field.</li>
            <li>Open <strong>Supporters → One-time</strong> and reload. Select the page request to <code className="break-all">studio.buymeacoffee.com/transactions/supporters</code> or a successful <code className="break-all">/api/supporters/onetime</code> request. Copy its request headers into the second field.</li>
          </ol>
          <p className="mt-3">The Cookie header value by itself is also accepted. Use request headers, not response headers or “Copy as fetch”. A console snippet using document.cookie cannot read protected HttpOnly session cookies.</p>
        </details>
        {[{ id: "bmc-app-session", label: "BMC app request headers", value: appHeaders, change: setAppHeaders }, { id: "bmc-studio-session", label: "BMC studio request headers", value: studioHeaders, change: setStudioHeaders }].map(field => <label key={field.id} htmlFor={field.id} className="grid gap-2 text-sm font-semibold">{field.label}
          <textarea id={field.id} required rows={4} maxLength={32768} value={field.value} onChange={event => field.change(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} className={`w-full resize-y rounded-xl border border-[var(--border)] bg-bg-deep p-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-lime ${showSession ? "" : "[-webkit-text-security:disc]"}`} />
        </label>)}</>}
        <label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={showSession} onChange={event => setShowSession(event.target.checked)} />Show pasted session</label>
        <p className="text-xs leading-relaxed text-text-tertiary">These headers grant access to your BMC account. Paste them only here. They are encrypted on the server and never stored in this browser’s local storage.</p>
        <button type="submit" className="min-h-11 justify-self-start rounded-xl bg-lime px-5 py-3 text-sm font-semibold text-bg-deep hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime disabled:opacity-50" disabled={busy || (manualImport ? !appHeaders.trim() || !studioHeaders.trim() : !sessionToken.trim())}>{busy && activeAction === "import" ? "Verifying session…" : "Verify and save session"}</button>
      </form>}
      {error && <div ref={feedbackRef} role="alert" className="mt-4 scroll-mt-24 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm leading-relaxed text-red-200"><p className="font-semibold">BMC session could not be updated</p><p className="mt-2">{error}</p></div>}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1"><dt className="text-text-tertiary">Last complete check</dt><dd className="mt-1 font-medium">{status.health.lastSuccessAt ? displayDateTime(status.health.lastSuccessAt) : "Waiting for first check"}</dd></div>
        <div><dt className="text-text-tertiary">Recorded payments</dt><dd className="mt-1 font-medium tabular-nums">{status.health.paymentCount}</dd></div>
        <div><dt className="text-text-tertiary">Needs review</dt><dd className="mt-1 font-medium tabular-nums">{status.health.reviewCount}</dd></div>
      </dl>
      <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-text-tertiary">Checks run every 15 minutes while the Sentinel bot is online. If BMC expires the session, admins receive a session-update notification. Previous history stays available.</p>
    </section>
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
      {!status.payments.length ? <p className="mt-5 rounded-xl border border-[var(--border)] p-5 text-sm text-text-secondary">{status.health.syncing ? "Fetching your full payment history…" : "Import a BMC session and run a history check to see recorded payments here."}</p> : <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
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
