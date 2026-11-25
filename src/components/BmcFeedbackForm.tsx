"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BMC_FEEDBACK_TEXT_LIMIT, fullBmcResponse } from "@/lib/bmc-feedback-response";

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
  return <section className="mt-8 border-t border-[var(--border)] pt-6">
    <h2 className="text-xl font-semibold">{completed ? "Recorded response" : "Tell us what happened"}</h2>
    {completed && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--text-secondary)]">{fullBmcResponse(feedback)}</p>}
    {readOnly && !completed && <p className="mt-3 text-[var(--text-secondary)]">The donor has not submitted this form yet.</p>}
    {!readOnly && (!completed || !feedback.additionalInfoAt) && <form onSubmit={submit} className="mt-5 grid gap-5">
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
      </> : <label className={labelClass}>Add additional info?
        <span id="feedback-addition-help" className="text-[var(--text-secondary)]">You can add information once. Your original response stays recorded, and admins will be notified.</span>
        <textarea required maxLength={BMC_FEEDBACK_TEXT_LIMIT} rows={6} value={additional} onChange={event => setAdditional(event.target.value)} className={inputClass} disabled={saving} aria-describedby="feedback-addition-help feedback-addition-limit" />
        <span id="feedback-addition-limit" className="text-xs text-[var(--text-secondary)]">{additional.length} / {BMC_FEEDBACK_TEXT_LIMIT} characters</span>
      </label>}
      {error && <p role="alert" className="text-sm text-[var(--coral)]">{error}</p>}
      <button disabled={saving || !!notice || (completed ? !additional.trim() : !wanted || !reason.trim() || (wanted === "false" && !deliberate))} className="min-h-11 justify-self-start rounded-xl bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lime)] disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : completed ? "Submit additional information" : "Submit response"}</button>
    </form>}
    {!readOnly && completed && feedback.additionalInfoAt && <p className="mt-5 text-sm text-[var(--text-secondary)]">Your additional information has been recorded. This form is complete.</p>}
    <p role="status" className="mt-4 text-sm text-[var(--lime)]">{notice}</p>
  </section>;
}
