"use client";

import { createPortal } from "react-dom";
import type { FormEvent, ReactNode } from "react";

export default function FormDialog({
  open,
  title,
  description,
  submitLabel,
  loading = false,
  error,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={() => !loading && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="form-dialog-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-bg-card p-6 shadow-2xl" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="form-dialog-title" className="text-base font-bold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-text-tertiary">{description}</p>}
        <div className="mt-4 space-y-4">{children}</div>
        {error && <p role="alert" className="mt-3 rounded-lg border border-coral/20 bg-coral/8 px-3 py-2 text-xs text-coral">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={loading} onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover">Cancel</button>
          <button type="submit" disabled={loading} className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-bg-void disabled:opacity-40">{loading ? `${submitLabel}…` : submitLabel}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
