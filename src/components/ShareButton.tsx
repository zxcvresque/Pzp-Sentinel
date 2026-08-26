"use client";

import { useRef, useState } from "react";

export default function ShareButton({
  entityType,
  entityId,
  label = "Share",
  contextTitle,
  contextDetails,
  className = "",
}: {
  entityType: string;
  entityId: string;
  label?: string;
  contextTitle?: string;
  contextDetails?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied">("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("shared", `${entityType}:${entityId}`);
    if (entityType === "transaction") url.searchParams.set("transactionId", entityId);
    if (entityType === "audit") url.searchParams.set("auditId", entityId);
    url.hash = `shared-${entityId}`;
    const entityLabel = entityType.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const target = buttonRef.current?.closest<HTMLElement>("[data-share-target]");
    const targetHeading = target?.querySelector<HTMLElement>("h1, h2, h3, [data-share-heading]")?.innerText.trim();
    const clean = (value?: string) => value?.replace(/\s+/g, " ").trim();
    const shareTitle = clean(contextTitle) || clean(targetHeading) || entityLabel;
    const shareDetails = clean(contextDetails);
    const summary = `Sentinel · ${shareTitle}${shareDetails ? ` — ${shareDetails}` : ""}`.slice(0, 180);
    const message = `${summary}\nOpen in Sentinel: ${url.toString()}`;
    try {
      await navigator.clipboard.writeText(message);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        await navigator.clipboard.writeText(message).catch(() => undefined);
        setState("copied");
        window.setTimeout(() => setState("idle"), 1800);
      }
    }
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={share}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-lime/30 hover:bg-lime/8 hover:text-lime ${className}`}
      aria-label={`Share ${entityType}`}
      title="Copy a Sentinel deep link"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </svg>
      {state === "copied" ? "Link copied" : label}
    </button>
  );
}
