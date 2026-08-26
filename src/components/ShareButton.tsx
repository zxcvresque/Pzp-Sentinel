"use client";

import { useState } from "react";

export default function ShareButton({
  entityType,
  entityId,
  label = "Share",
  className = "",
}: {
  entityType: string;
  entityId: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("shared", `${entityType}:${entityId}`);
    if (entityType === "transaction") url.searchParams.set("transactionId", entityId);
    if (entityType === "audit") url.searchParams.set("auditId", entityId);
    url.hash = `shared-${entityId}`;
    const title = `Sentinel · ${entityType}`;
    try {
      if (navigator.share) await navigator.share({ title, url: url.toString() });
      else await navigator.clipboard.writeText(url.toString());
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        await navigator.clipboard.writeText(url.toString()).catch(() => undefined);
        setState("copied");
        window.setTimeout(() => setState("idle"), 1800);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-lime/30 hover:bg-lime/8 hover:text-lime ${className}`}
      aria-label={`Share ${entityType}`}
      title="Copy a Sentinel deep link"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </svg>
      {state === "copied" ? "Link ready" : label}
    </button>
  );
}
