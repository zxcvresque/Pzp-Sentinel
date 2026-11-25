"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BMC_FEEDBACK_TEXT_LIMIT } from "@/lib/bmc-feedback-response";

export type BmcFeedbackView = {
  id: string; stage: string; wantedToDonate: boolean | null; deliberateCancellation: boolean | null;
  reason: string | null; additionalInfo: string | null; additionalInfoAt: string | null;
  respondedAt: string | null;
};

export default function BmcFeedbackForm({ feedback, readOnly = false }: { feedback: BmcFeedbackView; readOnly?: boolean }) {
  const router = useRouter();
  const [wanted, setWanted] = useState(feedback.wantedToDonate === null ? "" : String(feedback.wantedToDonate));
  const [deliberate, setDeliberate] = useState(feedback.deliberateCancellation === null ? "" : String(feedback.deliberateCancellation));
  const [reason, setReason] = useState(feedback.reason || "");
  const [additional, setAdditional] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const completed = feedback.stage === "COMPLETED";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/bmc/feedback/${encodeURIComponent(feedback.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completed ? { additionalInfo: additional } : {
          wantedToDonate: wanted === "true", deliberateCancellation: wanted === "false" ? deliberate === "true" : null, reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your response. Please try again.");
      setNotice(completed ? "Your additional information was saved. Admins have been notified." : "Your response was saved in Sentinel. Admins have been notified.");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect. Please try again."); }
    finally { setSaving(false); }
  }

  const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-3 text-base text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--lime)] disabled:opacity-60";
  const labelClass = "grid gap-2 text-sm text-[var(--text-primary)]";
  return <section className="mt-6 border-t border-[var(--border)] pt-6">
    <h2 className="text-lg font-semibold">{completed ? "Recorded response" : "Tell us what happened"}</h2>
    {completed && <dl className="mt-4 grid gap-4 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
        <dt className="text-[var(--text-secondary)]">Wanted to continue donating</dt>
        <dd className="font-medium text-[var(--text-primary)]">{feedback.wantedToDonate ? "Yes" : "No"}</dd>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4">
        <dt className="text-[var(--text-secondary)]">Deliberately cancelled</dt>
        <dd className="font-medium text-[var(--text-primary)]">{feedback.deliberateCancellation === null ? "Not asked" : feedback.deliberateCancellation ? "Yes" : "No"}</dd>
      </div>
      <div className="mt-1 grid gap-2">
        <dt className="font-medium text-[var(--text-primary)]">Reason</dt>
        <dd className="whitespace-pre-wrap break-words leading-6 text-[var(--text-secondary)]">{feedback.reason}</dd>
      </div>
      {feedback.additionalInfo && <div className="grid gap-2">
        <dt className="font-medium text-[var(--text-primary)]">Additional information</dt>
        <dd className="whitespace-pre-wrap break-words leading-6 text-[var(--text-secondary)]">{feedback.additionalInfo}</dd>
      </div>}
    </dl>}
    {readOnly && !completed && <p className="mt-3 text-[var(--text-secondary)]">The donor has not submitted this form yet.</p>}
    {!readOnly && (!completed || !feedback.additionalInfoAt) && <form onSubmit={submit} className={`grid gap-4 ${completed ? "mt-6 border-t border-[var(--border)] pt-6" : "mt-5"}`}>
      {!completed ? <>
        <label className={labelClass}>Did this stop even though you still wanted to continue donating?
          <select required value={wanted} onChange={event => setWanted(event.target.value)} className={inputClass} disabled={saving}>
            <option value="" disabled>Choose an answer</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </label>
        {wanted === "false" && <label className={labelClass}>Did you deliberately cancel or stop this autopay?
          <select required value={deliberate} onChange={event => setDeliberate(event.target.value)} className={inputClass} disabled={saving}>
            <option value="" disabled>Choose an answer</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </label>}
        <label className={labelClass}>What happened?
          <textarea required maxLength={BMC_FEEDBACK_TEXT_LIMIT} rows={7} value={reason} onChange={event => setReason(event.target.value)} className={inputClass} disabled={saving} aria-describedby="feedback-reason-limit" />
          <span id="feedback-reason-limit" className="text-xs text-[var(--text-secondary)]">{reason.length} / {BMC_FEEDBACK_TEXT_LIMIT} characters</span>
        </label>
      </> : <label className={labelClass}>
        <span className="text-lg font-semibold">Add additional information</span>
        <span id="feedback-addition-help" className="leading-6 text-[var(--text-secondary)]">One addition per form. Your original response stays saved, and admins will be notified.</span>
        <textarea required maxLength={BMC_FEEDBACK_TEXT_LIMIT} rows={4} value={additional} onChange={event => setAdditional(event.target.value)} className={`${inputClass} min-h-32 resize-y`} disabled={saving} aria-describedby="feedback-addition-help feedback-addition-limit" />
        <span id="feedback-addition-limit" className="text-right text-xs tabular-nums text-[var(--text-secondary)]">{additional.length} / {BMC_FEEDBACK_TEXT_LIMIT} characters</span>
      </label>}
      {error && <p role="alert" className="text-sm text-[var(--coral)]">{error}</p>}
      <button disabled={saving || !!notice || (completed ? !additional.trim() : !wanted || !reason.trim() || (wanted === "false" && !deliberate))} className="min-h-11 w-full rounded-xl bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lime)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:justify-self-start">{saving ? "Saving…" : completed ? "Submit additional information" : "Submit response"}</button>
    </form>}
    {!readOnly && completed && feedback.additionalInfoAt && <p className="mt-5 text-sm text-[var(--text-secondary)]">Your additional information has been recorded. This form is complete.</p>}
    <p role="status" className={`${notice ? "mt-4" : ""} text-sm text-[var(--lime)]`}>{notice}</p>
  </section>;
}
