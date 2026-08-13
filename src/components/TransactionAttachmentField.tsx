"use client";

import Image from "next/image";
import { useRef, useState } from "react";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function attachmentName(url: string) {
  try {
    const name = decodeURIComponent(url.split("/").pop() || "Attachment");
    return name || "Attachment";
  } catch {
    return url.split("/").pop() || "Attachment";
  }
}

function isImageAttachment(url: string) {
  if (url.startsWith("/api/avatar/")) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachmentName(url));
}

export default function TransactionAttachmentField({
  value,
  onChange,
  onUploadingChange,
}: {
  value: string[];
  onChange: (attachments: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  async function upload(files: File[]) {
    if (!files.length) return;
    setError("");

    if (value.length + files.length > MAX_FILES) {
      setError(`A transaction can have at most ${MAX_FILES} attachments.`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" exceeds the 20 MB limit.`);
      return;
    }

    setUploading(true);
    onUploadingChange?.(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("files", file);
        const response = await fetch("/api/attachments", { method: "POST", body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (uploaded.length) onChange([...value, ...uploaded]);
          throw new Error(data.error || `Could not upload "${file.name}"`);
        }
        uploaded.push(...((data.urls || []) as string[]));
      }
      onChange([...value, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachments");
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">Attachments</label>
        <span className="text-[10px] text-text-tertiary">Any file type · 20 MB each · up to 10 files</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => void upload(Array.from(event.target.files || []))}
      />
      <button
        type="button"
        disabled={uploading || value.length >= MAX_FILES}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(Array.from(event.dataTransfer.files));
        }}
        className={`flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? "border-lime/60 bg-lime/[.06]" : "border-[var(--border)] bg-bg-deep hover:border-lime/30 hover:bg-lime/[.03]"}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mb-2 h-6 w-6 text-text-tertiary"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
        <span className="text-sm font-semibold text-text-secondary">{uploading ? "Uploading attachments…" : "Choose files or drop them here"}</span>
        <span className="mt-1 text-[11px] text-text-tertiary">Images, PDFs, documents, archives, or any other file</span>
      </button>

      {error && <p role="alert" className="mt-2 text-xs text-coral">{error}</p>}

      {value.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {value.map((url) => (
            <div key={url} className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] bg-white/[.025] p-2.5">
              {isImageAttachment(url) ? (
                <Image src={url} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-violet/10 text-violet">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /></svg>
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text-secondary" title={attachmentName(url)}>{attachmentName(url)}</p>
                <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-violet hover:underline">Open attachment</a>
              </div>
              <button type="button" onClick={() => onChange(value.filter((item) => item !== url))} className="shrink-0 rounded-full p-1.5 text-text-tertiary hover:bg-coral/10 hover:text-coral" aria-label={`Remove ${attachmentName(url)}`}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4"><path d="m5 5 10 10M15 5 5 15" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
