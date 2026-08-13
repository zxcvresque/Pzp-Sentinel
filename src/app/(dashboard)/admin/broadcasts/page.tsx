"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import BroadcastContent, { BroadcastInlineContent } from "@/components/BroadcastContent";
import TgUser from "@/components/TgUser";
import {
  canSendBroadcastToTelegramGroup,
  type BroadcastAudience,
  type BroadcastRecipientMode,
} from "@/lib/broadcast-audience";

interface BroadcastRecipient {
  id: string;
  name: string;
  telegramUser: string;
  photoUrl: string | null;
  roles: string[];
}

interface BroadcastConfig {
  recipients: BroadcastRecipient[];
  counts: { admins: number; donors: number; devs: number; everyone: number };
  telegramConfigured: boolean;
}

interface DeliveryResults {
  sentinel?: { requested: number; delivered: number; failed: number };
  telegram?: { delivered: boolean; error?: string };
}

const AUDIENCE_OPTIONS: Array<{
  value: BroadcastAudience;
  label: string;
  description: string;
  countKey: keyof BroadcastConfig["counts"];
}> = [
  { value: "ADMINS", label: "Admins", description: "Active administrator accounts", countKey: "admins" },
  { value: "DONORS", label: "Donors", description: "Active donor accounts", countKey: "donors" },
  { value: "DEVS", label: "Developers", description: "Active developer accounts", countKey: "devs" },
  { value: "EVERYONE", label: "Everyone", description: "All approved accounts", countKey: "everyone" },
];

export default function BroadcastsPage() {
  const [config, setConfig] = useState<BroadcastConfig | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendSentinel, setSendSentinel] = useState(true);
  const [sendTelegram, setSendTelegram] = useState(false);
  const [highPriority, setHighPriority] = useState(true);
  const [audience, setAudience] = useState<BroadcastAudience>("DONORS");
  const [recipientMode, setRecipientMode] = useState<BroadcastRecipientMode>("ALL");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientRoleFilter, setRecipientRoleFilter] = useState<"ALL" | "ADMIN" | "DONOR" | "DEV">("ALL");
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

  const eligibleRecipients = useMemo(() => {
    const recipients = config?.recipients ?? [];
    if (audience === "ADMINS") return recipients.filter((recipient) => recipient.roles.includes("ADMIN"));
    if (audience === "DONORS") return recipients.filter((recipient) => recipient.roles.includes("DONOR"));
    if (audience === "DEVS") return recipients.filter((recipient) => recipient.roles.includes("DEV"));
    return recipients;
  }, [audience, config?.recipients]);

  const visibleRecipients = useMemo(() => {
    const search = recipientSearch.trim().toLowerCase();
    return eligibleRecipients.filter((recipient) => (
      (recipientRoleFilter === "ALL" || recipient.roles.includes(recipientRoleFilter))
      && (!search || recipient.name.toLowerCase().includes(search)
        || recipient.telegramUser.toLowerCase().includes(search))
    ));
  }, [eligibleRecipients, recipientRoleFilter, recipientSearch]);

  const selectedRecipientSet = useMemo(() => new Set(selectedRecipientIds), [selectedRecipientIds]);
  const sentinelRecipientCount = recipientMode === "ALL"
    ? eligibleRecipients.length
    : selectedRecipientIds.length;
  const telegramAudienceAllowed = canSendBroadcastToTelegramGroup(audience, recipientMode);
  const telegramAvailable = Boolean(config?.telegramConfigured && telegramAudienceAllowed);
  const canSend = Boolean(
    title.trim()
    && message.trim()
    && (sendSentinel || sendTelegram)
    && (!sendSentinel || sentinelRecipientCount > 0),
  );
  const destinations = [
    sendSentinel ? `${sentinelRecipientCount} selected member${sentinelRecipientCount === 1 ? "" : "s"} in Sentinel` : null,
    sendTelegram ? "the donors/funds Telegram group" : null,
  ].filter(Boolean).join(" and ");

  function changeAudience(nextAudience: BroadcastAudience) {
    setAudience(nextAudience);
    setSelectedRecipientIds([]);
    setRecipientSearch("");
    setRecipientRoleFilter("ALL");
    if (nextAudience === "DEVS" || nextAudience === "ADMINS") setSendTelegram(false);
  }

  function changeRecipientMode(nextMode: BroadcastRecipientMode) {
    setRecipientMode(nextMode);
    setSelectedRecipientIds([]);
    setRecipientSearch("");
    setRecipientRoleFilter("ALL");
    if (nextMode === "SELECTED") setSendTelegram(false);
  }

  function toggleRecipient(id: string) {
    setSelectedRecipientIds((current) => current.includes(id)
      ? current.filter((recipientId) => recipientId !== id)
      : [...current, id]);
  }

  function toggleVisibleRecipients() {
    const visibleIds = visibleRecipients.map((recipient) => recipient.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedRecipientSet.has(id));
    setSelectedRecipientIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  }

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
        body: JSON.stringify({
          title,
          message,
          sendSentinel,
          sendTelegram,
          highPriority,
          audience,
          recipientMode,
          recipientIds: recipientMode === "SELECTED" ? selectedRecipientIds : [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Broadcast failed");

      const results = data.results as DeliveryResults;
      const parts: string[] = [];
      if (results.sentinel) {
        parts.push(`Sentinel: ${results.sentinel.delivered}/${results.sentinel.requested} delivered`);
        if (results.sentinel.failed > 0) parts.push(`${results.sentinel.failed} Sentinel failure${results.sentinel.failed === 1 ? "" : "s"}`);
      }
      if (results.telegram?.delivered) parts.push("Telegram group: sent");
      if (results.telegram && !results.telegram.delivered) parts.push(`Telegram group: ${results.telegram.error || "failed"}`);
      const partialFailure = Boolean(
        (results.telegram && !results.telegram.delivered)
        || (results.sentinel && results.sentinel.failed > 0),
      );
      setFeedback({ tone: partialFailure ? "error" : "success", text: parts.join(" · ") });
      if (!partialFailure) {
        setTitle("");
        setMessage("");
        setSelectedRecipientIds([]);
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
          Sentinel <span className="font-display text-lime">Broadcasts</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Send a rich announcement to all donors, all developers, everyone, or a carefully selected group of people.
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
            <legend className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Audience</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {AUDIENCE_OPTIONS.map((option) => {
                const active = audience === option.value;
                const count = config?.counts[option.countKey] ?? 0;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeAudience(option.value)}
                    className={`rounded-xl border p-4 text-left transition-colors ${active
                      ? "border-lime/35 bg-lime/[0.06]"
                      : "border-[var(--border)] bg-bg-deep hover:border-[var(--border-hover)]"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-text-primary">{option.label}</span>
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] ${active ? "bg-lime/12 text-lime" : "bg-[var(--bg-hover)] text-text-tertiary"}`}>
                        {count}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <legend className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Recipients</legend>
              <span className="font-mono text-[10px] text-text-tertiary">
                {sentinelRecipientCount} recipient{sentinelRecipientCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-2 rounded-xl border border-[var(--border)] bg-bg-deep p-1">
              <button
                type="button"
                aria-pressed={recipientMode === "ALL"}
                onClick={() => changeRecipientMode("ALL")}
                className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${recipientMode === "ALL"
                  ? "bg-[var(--bg-hover)] text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-primary"}`}
              >
                All in audience
              </button>
              <button
                type="button"
                aria-pressed={recipientMode === "SELECTED"}
                onClick={() => changeRecipientMode("SELECTED")}
                className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${recipientMode === "SELECTED"
                  ? "bg-[var(--bg-hover)] text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-primary"}`}
              >
                Specific people
              </button>
            </div>

            {recipientMode === "SELECTED" && (
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-bg-deep">
                <div className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center">
                  <input
                    type="search"
                    value={recipientSearch}
                    onChange={(event) => setRecipientSearch(event.target.value)}
                    placeholder="Search name or Telegram username"
                    aria-label="Search broadcast recipients"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-lime/30"
                  />
                  <select
                    value={recipientRoleFilter}
                    onChange={(event) => setRecipientRoleFilter(event.target.value as typeof recipientRoleFilter)}
                    aria-label="Filter broadcast recipients by role"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-lime/30"
                  >
                    <option value="ALL">All roles</option>
                    <option value="ADMIN">Admins</option>
                    <option value="DONOR">Donors</option>
                    <option value="DEV">Developers</option>
                  </select>
                  <button
                    type="button"
                    onClick={toggleVisibleRecipients}
                    disabled={visibleRecipients.length === 0}
                    className="shrink-0 rounded-full border border-[var(--border)] px-3 py-2 text-[10px] font-semibold text-text-secondary transition-colors hover:border-lime/25 hover:text-lime disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {visibleRecipients.length > 0 && visibleRecipients.every((recipient) => selectedRecipientSet.has(recipient.id))
                      ? "Clear visible"
                      : "Select visible"}
                  </button>
                </div>

                <div className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
                  {visibleRecipients.length === 0 ? (
                    <p className="p-5 text-center text-xs text-text-tertiary">No matching active members.</p>
                  ) : visibleRecipients.map((recipient) => {
                    const selected = selectedRecipientSet.has(recipient.id);
                    return (
                      <label
                        key={recipient.id}
                        className={`flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors ${selected ? "bg-lime/[0.04]" : "hover:bg-[var(--bg-hover)]"}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRecipient(recipient.id)}
                          className="h-4 w-4 shrink-0 accent-[var(--lime)]"
                        />
                        <TgUser name={recipient.name} telegramUser={null} photoUrl={recipient.photoUrl} size={36} avatarOnly />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-primary">{recipient.name}</span>
                          <span className="block truncate text-[11px] text-text-tertiary">
                            {recipient.telegramUser ? `@${recipient.telegramUser}` : "No Telegram username"}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          {recipient.roles.filter((role) => role === "ADMIN" || role === "DONOR" || role === "DEV").map((role) => (
                            <span key={role} className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[8px] text-text-tertiary">
                              {role}
                            </span>
                          ))}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Priority</legend>
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${highPriority
              ? "border-coral/30 bg-coral/[0.05]"
              : "border-[var(--border)] bg-bg-deep"}`}
            >
              <input
                type="checkbox"
                checked={highPriority}
                onChange={(event) => setHighPriority(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--coral)]"
              />
              <span>
                <span className="block text-sm font-semibold text-text-primary">High priority</span>
                <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">
                  Default on. Opens the Sentinel pop-up and sends the formatted announcement by Telegram DM to linked recipients, even when their SYSTEM DM preference is off.
                </span>
              </span>
            </label>
            {!highPriority && (
              <p className="mt-2 text-xs leading-relaxed text-text-tertiary">
                Normal broadcasts stay in the notification center without interrupting recipients or sending a personal DM.
              </p>
            )}
          </fieldset>

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
                  <span className="block text-sm font-semibold text-text-primary">Sentinel notification</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">
                    {config
                      ? `${sentinelRecipientCount} active selected recipient${sentinelRecipientCount === 1 ? "" : "s"}`
                      : "Loading recipients..."}
                  </span>
                </span>
              </label>

              <label className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${!telegramAvailable ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${sendTelegram ? "border-violet/30 bg-violet/[0.05]" : "border-[var(--border)] bg-bg-deep"}`}>
                <input
                  type="checkbox"
                  checked={sendTelegram}
                  disabled={!telegramAvailable}
                  onChange={(event) => setSendTelegram(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--violet)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-text-primary">Telegram group</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-tertiary">
                    {!config?.telegramConfigured
                      ? "Group or bot configuration missing"
                      : recipientMode === "SELECTED"
                        ? "Unavailable for individually selected recipients"
                        : audience === "DEVS"
                          ? "Configured group is donor-facing, not developer-only"
                          : audience === "EVERYONE"
                            ? "Posts to the donors group; developers receive Sentinel delivery"
                            : "Donors/funds group configured"}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {!sendSentinel && !sendTelegram && (
            <p className="text-xs text-coral">Select at least one destination.</p>
          )}
          {sendSentinel && sentinelRecipientCount === 0 && (
            <p className="text-xs text-coral">Select at least one active recipient.</p>
          )}

          <div className="rounded-xl border border-[var(--border)] bg-bg-deep p-4">
            <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
              <span>Preview</span>
              <span className={highPriority ? "text-coral" : "text-text-tertiary"}>{highPriority ? "High priority" : "Normal"}</span>
            </div>
            <div className="text-sm font-semibold text-text-primary"><BroadcastInlineContent message={title || "Broadcast title"} /></div>
            <div className="mt-2 text-text-secondary">
              <BroadcastContent message={message || "Your Sentinel announcement will appear here."} />
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
