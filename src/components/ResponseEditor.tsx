"use client";

import { useRef, useState } from "react";
import BroadcastContent from "./BroadcastContent";
import { BMC_FEEDBACK_TEXT_LIMIT } from "@/lib/bmc-feedback-response";

export default function ResponseEditor({ id, label, hint, value, onChange, disabled }: {
  id: string; label: string; hint: string; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  function wrap(before: string, after: string, fallback: string) {
    const field = input.current;
    if (!field) return;
    const { selectionStart: start, selectionEnd: end } = field;
    const selected = value.slice(start, end) || fallback;
    const result = value.slice(0, start) + before + selected + after + value.slice(end);
    if (result.length > BMC_FEEDBACK_TEXT_LIMIT) return;
    onChange(result);
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + before.length, start + before.length + selected.length); });
  }
  return <div className="grid gap-2">
    <label htmlFor={id} className="text-sm font-semibold text-text-primary">{label}</label>
    <p id={`${id}-hint`} className="text-sm leading-6 text-text-secondary">{hint}</p>
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] focus-within:border-lime/50">
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
        {[
          { label: "Bold", before: "**", after: "**", fallback: "bold text", className: "font-bold" },
          { label: "Italic", before: "*", after: "*", fallback: "italic text", className: "italic" },
        ].map(item => <button key={item.label} type="button" title={item.label} aria-label={`Format ${item.label.toLowerCase()}`} disabled={disabled || preview} onClick={() => wrap(item.before, item.after, item.fallback)} className={`min-h-9 rounded-md px-3 text-sm text-text-secondary hover:bg-[var(--bg-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-lime disabled:opacity-40 ${item.className}`}>{item.label}</button>)}
        <button type="button" onClick={() => setPreview(!preview)} aria-pressed={preview} className="ml-auto min-h-9 rounded-md px-3 text-xs font-semibold text-lime hover:bg-lime/10 focus-visible:outline-2 focus-visible:outline-lime">{preview ? "Edit text" : "Preview"}</button>
      </div>
      {preview && <div className="min-h-36 px-4 py-3"><BroadcastContent message={value || "Your formatted response will appear here."} className="break-words text-text-secondary" /></div>}
      <textarea ref={input} id={id} required maxLength={BMC_FEEDBACK_TEXT_LIMIT} rows={5} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} aria-describedby={`${id}-hint ${id}-count`} placeholder="Write your response…" className={`${preview ? "sr-only" : "block min-h-36 w-full resize-y"} bg-transparent px-4 py-3 text-base leading-7 text-text-primary outline-none placeholder:text-text-secondary disabled:opacity-60`} />
    </div>
    <span id={`${id}-count`} className="text-right text-xs tabular-nums text-text-secondary">{value.length} / {BMC_FEEDBACK_TEXT_LIMIT} characters</span>
  </div>;
}
