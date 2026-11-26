"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ResponseEditor from "@/components/ResponseEditor";
import BmcResponseView from "@/components/BmcResponseView";

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
  const labelClass = "grid gap-2 text-sm font-medium text-[var(--text-primary)]";
  return <section className="mt-6">
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{completed ? "Recorded response" : "Tell us what happened"}</h2>
      <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${completed ? "bg-lime/10 text-lime" : "bg-amber/10 text-amber"}`}>{completed ? "Response saved" : "Awaiting response"}</span>
    </div>
    {completed && <BmcResponseView feedback={feedback} />}
    {readOnly && !completed && <p className="mt-3 text-[var(--text-secondary)]">The donor has not submitted this form yet.</p>}
    </div>
    {!readOnly && (!completed || !feedback.additionalInfoAt) && <form onSubmit={submit} className={`grid gap-4 ${completed ? "mt-7" : "mt-5"}`}>
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
        <ResponseEditor id="feedback-reason" label="What happened?" hint="Describe what happened. Your response is shared privately with admins." value={reason} onChange={setReason} disabled={saving} />
      </> : <>
        <h2 className="text-lg font-semibold">Add additional information</h2>
        <ResponseEditor id="feedback-addition" label="Your addition" hint="One addition per form. Your original response stays saved, and admins will be notified." value={additional} onChange={setAdditional} disabled={saving} />
      </>}
      {error && <p role="alert" className="text-sm text-[var(--coral)]">{error}</p>}
      <button disabled={saving || !!notice || (completed ? !additional.trim() : !wanted || !reason.trim() || (wanted === "false" && !deliberate))} className="min-h-11 w-full rounded-xl bg-[var(--lime)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lime)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:justify-self-start">{saving ? "Saving…" : completed ? "Submit additional information" : "Submit response"}</button>
    </form>}
    {completed && feedback.additionalInfoAt && <p className="mt-5 flex items-start gap-2 text-sm italic leading-6 text-text-secondary"><svg aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-lime" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 12 4 4L19 6" /></svg>Additional information recorded. This form is complete.</p>}
    <p role="status" className={`${notice ? "mt-4" : ""} text-sm text-[var(--lime)]`}>{notice}</p>
  </section>;
}
