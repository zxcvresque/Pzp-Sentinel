"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import BroadcastContent, { BroadcastInlineContent } from "@/components/BroadcastContent";

interface BroadcastConfig {
  donorCount: number;
  telegramConfigured: boolean;
}

interface DeliveryResults {
  sentinel?: { delivered: number };
  telegram?: { delivered: boolean; error?: string };
}

export default function BroadcastsPage() {
  const [config, setConfig] = useState<BroadcastConfig | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendSentinel, setSendSentinel] = useState(true);
  const [sendTelegram, setSendTelegram] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/broadcasts", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load broadcast settings");
        setConfig(data);
      })
      .catch((error) => setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not load broadcast settings",
      }));
  }, []);

  const canSend = Boolean(title.trim() && message.trim() && (sendSentinel || sendTelegram));
  const destinations = [
    sendSentinel ? `${config?.donorCount ?? 0} active donors in Sentinel` : null,
    sendTelegram ? "the donors/funds Telegram group" : null,
  ].filter(Boolean).join(" and ");

  function applyFormat(before: string, after = before, placeholder = "text") {
    const input = messageRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = message.slice(start, end) || placeholder;
    const replacement = `${before}${selectedText}${after}`;
    setMessage(`${message.slice(0, start)}${replacement}${message.slice(end)}`);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, start + before.length + selectedText.length);
    });
  }

  function applyTitleFormat(before: string, after = before, placeholder = "title") {
    const input = titleRef.current;
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const selectedText = title.slice(start, end) || placeholder;
    const replacement = `${before}${selectedText}${after}`;
    setTitle(`${title.slice(0, start)}${replacement}${title.slice(end)}`.slice(0, 80));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, Math.min(start + before.length + selectedText.length, 80));
    });
  }

  function applyQuote() {
    const input = messageRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = message.slice(start, end) || "quoted message";
    const replacement = selectedText.split("\n").map((line) => `> ${line}`).join("\n");
    setMessage(`${message.slice(0, start)}${replacement}${message.slice(end)}`);
    requestAnimationFrame(() => input.focus());
  }

  async function sendBroadcast() {
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message, sendSentinel, sendTelegram }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Broadcast failed");

      const results = data.results as DeliveryResults;
      const parts: string[] = [];
      if (results.sentinel) parts.push(`Sentinel: ${results.sentinel.delivered} donor notification${results.sentinel.delivered === 1 ? "" : "s"}`);
      if (results.telegram?.delivered) parts.push("Telegram group: sent");
      if (results.telegram && !results.telegram.delivered) parts.push(`Telegram group: ${results.telegram.error || "failed"}`);
      const partialFailure = results.telegram && !results.telegram.delivered;
      setFeedback({ tone: partialFailure ? "error" : "success", text: parts.join(" · ") });
      if (!partialFailure) {
        setTitle("");
        setMessage("");
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Broadcast failed" });
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={sendBroadcast}
        title="Send this broadcast now?"
        message={`This will immediately notify ${destinations}.`}
        confirmLabel="Send broadcast"
        variant="default"
        loading={sending}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-extrabold">
          Donor <span className="font-display text-lime">Broadcasts</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Send an immediate announcement to donor accounts in Sentinel, the donors/funds Telegram group, or both.
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          className={`mb-4 rounded-xl border p-4 text-sm ${feedback.tone === "success"
            ? "border-mint/20 bg-mint/8 text-mint"
            : "border-coral/20 bg-coral/8 text-coral"}`}
        >
          {feedback.text}
        </div>
      )}

      <form
        className="card overflow-hidden"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) setConfirmOpen(true);
        }}
      >
        <div className="border-b border-[var(--border)] p-5 sm:p-6">
          <h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">Compose announcement</h2>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="broadcast-title" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Title</label>
              <span className="font-mono text-[10px] text-text-tertiary">{title.length}/80</span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-bg-deep p-1.5" aria-label="Title formatting">
              <FormatButton label="Bold title" title="Bold" onClick={() => applyTitleFormat("**")}><strong>B</strong></FormatButton>
              <FormatButton label="Italic title" title="Italic" onClick={() => applyTitleFormat("*")}><em>I</em></FormatButton>
              <FormatButton label="Underline title" title="Underline" onClick={() => applyTitleFormat("__")}><u>U</u></FormatButton>
              <FormatButton label="Strike-through title" title="Strike-through" onClick={() => applyTitleFormat("~~")}><s>S</s></FormatButton>
              <FormatButton label="Code in title" title="Inline code" onClick={() => applyTitleFormat("`", "`", "code")}><span className="font-mono">&lt;/&gt;</span></FormatButton>
              <FormatButton label="Link in title" title="Link" onClick={() => applyTitleFormat("[", "](https://example.com)", "link")}>↗</FormatButton>
            </div>
            <input
              ref={titleRef}
              id="broadcast-title"
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: Donation drive update"
              className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 text-text-primary outline-none transition-colors focus:border-lime/30"
              required
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="broadcast-message" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Message</label>
              <span className={`font-mono text-[10px] ${message.length > 3300 ? "text-amber" : "text-text-tertiary"}`}>{message.length}/3500</span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-bg-deep p-1.5" aria-label="Message formatting">
              <FormatButton label="Bold" title="Bold" onClick={() => applyFormat("**")}><strong>B</strong></FormatButton>
              <FormatButton label="Italic" title="Italic" onClick={() => applyFormat("*")}><em>I</em></FormatButton>
              <FormatButton label="Underline" title="Underline" onClick={() => applyFormat("__")}><u>U</u></FormatButton>
              <FormatButton label="Strike-through" title="Strike-through" onClick={() => applyFormat("~~")}><s>S</s></FormatButton>
              <FormatButton label="Inline code" title="Inline code" onClick={() => applyFormat("`", "`", "code")}><span className="font-mono">&lt;/&gt;</span></FormatButton>
              <FormatButton label="Quote" title="Quote" onClick={applyQuote}>❝</FormatButton>
              <FormatButton label="Link" title="Link" onClick={() => applyFormat("[", "](https://example.com)", "link text")}>↗</FormatButton>
              <span className="ml-auto self-center px-2 text-[9px] text-text-tertiary">Telegram + Sentinel compatible</span>
            </div>
            <textarea
              ref={messageRef}
              id="broadcast-message"
              value={message}
              maxLength={3500}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write the message donors should receive..."
              rows={9}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-bg-deep px-4 py-3 text-text-primary outline-none transition-colors focus:border-lime/30"
              required
            />
          </div>

          <fieldset>
            <legend className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Destinations</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${sendSentinel ? "border-lime/30 bg-lime/[0.05]" : "border-[var(--border)] bg-bg-deep"}`}>
                <input
                  type="checkbox"
                  checked={sendSentinel}
                  onChange={(event) => setSendSentinel(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--lime)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-text-primary">Sentinel pop-up</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">
                    {config ? `${config.donorCount} active donor account${config.donorCount === 1 ? "" : "s"}` : "Loading donor count..."}
                  </span>
                </span>
              </label>

              <label className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${!config?.telegramConfigured ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${sendTelegram ? "border-violet/30 bg-violet/[0.05]" : "border-[var(--border)] bg-bg-deep"}`}>
                <input
                  type="checkbox"
                  checked={sendTelegram}
                  disabled={!config?.telegramConfigured}
                  onChange={(event) => setSendTelegram(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--violet)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-text-primary">Telegram group</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">
                    {config?.telegramConfigured ? "Donors/funds group configured" : "Group or bot configuration missing"}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {!sendSentinel && !sendTelegram && (
            <p className="text-xs text-coral">Select at least one destination.</p>
          )}

          <div className="rounded-xl border border-[var(--border)] bg-bg-deep p-4">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">Preview</div>
            <div className="text-sm font-semibold text-text-primary"><BroadcastInlineContent message={title || "Broadcast title"} /></div>
            <div className="mt-2 text-text-secondary">
              <BroadcastContent message={message || "Your donor announcement will appear here."} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-5 sm:p-6">
          <p className="text-xs text-text-tertiary">Broadcasts are immediate and recorded in the audit log.</p>
          <button
            type="submit"
            disabled={!canSend || sending}
            className="rounded-full bg-lime px-6 py-2.5 text-sm font-semibold text-bg-void transition-colors hover:bg-lime/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review & send
          </button>
        </div>
      </form>
    </div>
  );
}

function FormatButton({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={title} onClick={onClick} className="flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-text-primary">{children}</button>;
}
