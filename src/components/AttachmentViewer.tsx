"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

export function attachmentName(url: string, fallback = "Attachment") {
  try {
    return decodeURIComponent(url.split("/").pop() || fallback) || fallback;
  } catch {
    return url.split("/").pop() || fallback;
  }
}

function previewKind(contentType: string, name: string) {
  if (contentType.startsWith("image/") || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(name)) return "image";
  if (contentType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("text/")) return "text";
  return "download";
}

export default function AttachmentViewer({
  url,
  children,
  className = "",
  label,
}: {
  url: string;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState("");
  const [contentType, setContentType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const name = attachmentName(url, label || "Attachment");

  const show = () => {
    setLoading(true);
    setError("");
    setObjectUrl("");
    setContentType("");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    let createdUrl = "";
    fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || `Could not open this file (${response.status})`);
        }
        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);
        setContentType(blob.type || response.headers.get("content-type") || "application/octet-stream");
        setObjectUrl(createdUrl);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not open this file");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const kind = previewKind(contentType, name);

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={className}
        aria-label={label || `Open ${name}`}
      >
        {children ?? name}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex h-[min(92dvh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-bg-card shadow-[0_30px_120px_rgba(0,0,0,.75)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="font-mono text-[8px] uppercase tracking-[.15em] text-violet">Secure in-app viewer</p>
                <h2 id={titleId} className="mt-1 truncate text-sm font-bold text-text-primary" title={name}>{name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {objectUrl && (
                  <a href={objectUrl} download={name} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-lime">
                    Download
                  </a>
                )}
                <button type="button" onClick={() => setOpen(false)} autoFocus className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border)] text-text-secondary hover:border-coral/30 hover:text-coral" aria-label="Close attachment viewer">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4"><path d="m5 5 10 10M15 5 5 15" /></svg>
                </button>
              </div>
            </header>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-bg-deep p-2 sm:p-4">
              {loading && <div className="flex items-center gap-3 text-sm text-text-secondary"><span className="h-5 w-5 animate-spin rounded-full border-2 border-violet/20 border-t-violet" />Loading attachment securely…</div>}
              {error && <div role="alert" className="max-w-md rounded-xl border border-coral/20 bg-coral/[.06] p-5 text-center text-sm text-coral">{error}</div>}
              {!loading && !error && objectUrl && kind === "image" && <div className="relative h-full w-full"><Image src={objectUrl} alt={name} fill unoptimized sizes="100vw" className="rounded-lg object-contain" /></div>}
              {!loading && !error && objectUrl && (kind === "pdf" || kind === "text") && <iframe src={objectUrl} title={name} className="h-full w-full rounded-lg border-0 bg-white" />}
              {!loading && !error && objectUrl && kind === "video" && <video src={objectUrl} controls className="max-h-full max-w-full rounded-lg" />}
              {!loading && !error && objectUrl && kind === "audio" && <audio src={objectUrl} controls className="w-full max-w-xl" />}
              {!loading && !error && objectUrl && kind === "download" && <div className="max-w-md rounded-xl border border-[var(--border)] bg-bg-card p-6 text-center"><p className="text-sm font-semibold text-text-primary">This file type cannot be previewed here.</p><p className="mt-2 text-xs text-text-tertiary">Use Download above to open it with an app on this device.</p></div>}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
