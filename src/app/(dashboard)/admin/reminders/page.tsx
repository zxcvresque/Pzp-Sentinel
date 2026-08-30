"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";
import TgUser from "@/components/TgUser";
import FormExample from "@/components/FormExample";
import ConfirmDialog from "@/components/ConfirmDialog";
import FormDialog from "@/components/FormDialog";
import { reminderRepeatLabel, type ReminderFrequency, type ReminderRepeatUnit } from "@/lib/admin-reminders";

interface Reminder {
  id: string;
  message: string;
  frequency: string;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  nextFire: string;
  channel: string;
  createdBy: { name: string; photoUrl?: string | null; telegramUser?: string | null };
  createdAt: string;
  owner?: { id: string; name: string; photoUrl?: string | null; telegramUser?: string | null } | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: { id: string; name: string; photoUrl?: string | null; telegramUser?: string | null } | null;
  escalationAt?: string | null;
  escalatedAt?: string | null;
}

const FREQ_COLORS: Record<string, string> = {
  ONCE: "text-text-tertiary",
  DAILY: "text-cyan",
  WEEKLY: "text-violet",
  MONTHLY: "text-amber",
  CUSTOM: "text-lime",
};

const CHANNEL_COLORS: Record<string, string> = {
  BOT: "text-cyan",
  WEB: "text-blue",
  BOTH: "text-mint",
};

function localDateTimeValue(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [message, setMessage] = useState("");
  const [frequency, setFrequency] = useState("ONCE");
  const [repeatEvery, setRepeatEvery] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState("DAY");
  const [nextFire, setNextFire] = useState("");
  const [channel, setChannel] = useState("BOTH");
  const [errorMsg, setErrorMsg] = useState("");
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; photoUrl?: string | null }>>([]);
  const [ownerId, setOwnerId] = useState("");
  const [escalationAt, setEscalationAt] = useState("");
  const [snoozeTarget, setSnoozeTarget] = useState<Reminder | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/reminders").then((r) => { if (!r.ok) throw new Error("Could not load reminders"); return r.json(); }), fetch("/api/users").then((r) => { if (!r.ok) throw new Error("Could not load reminder owners"); return r.json(); })])
      .then(([data, userData]) => {
        setReminders(data.reminders || []);
        setAdmins((userData.users || []).filter((candidate: { roles: string[]; status: string }) => candidate.roles.includes("ADMIN") && candidate.status === "ACTIVE"));
      })
      .catch((error) => setErrorMsg(error instanceof Error ? error.message : "Could not load reminders"))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setMessage("");
    setFrequency("ONCE");
    setRepeatEvery("1");
    setRepeatUnit("DAY");
    setNextFire("");
    setChannel("BOTH");
    setErrorMsg("");
    setOwnerId("");
    setEscalationAt("");
    setEditingId(null);
  }

  function handleEdit(rem: Reminder) {
    setEditingId(rem.id);
    setMessage(rem.message);
    const isLegacyRepeat = rem.frequency !== "ONCE" && rem.frequency !== "CUSTOM";
    setFrequency(isLegacyRepeat ? "CUSTOM" : rem.frequency);
    setRepeatEvery(String(rem.repeatEvery ?? 1));
    setRepeatUnit(rem.repeatUnit ?? (
      rem.frequency === "WEEKLY" ? "WEEK" : rem.frequency === "MONTHLY" ? "MONTH" : "DAY"
    ));
    setNextFire(localDateTimeValue(rem.nextFire));
    setChannel(rem.channel);
    setOwnerId(rem.owner?.id || "");
    setEscalationAt(rem.escalationAt ? localDateTimeValue(rem.escalationAt) : "");
    setErrorMsg("");
    setShowForm(true);
  }

  function handleCancelForm() {
    setShowForm(false);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");

    const firstSend = new Date(nextFire);
    if (Number.isNaN(firstSend.getTime()) || firstSend <= new Date()) {
      setErrorMsg("First send must be in the future.");
      setSubmitting(false);
      document.getElementById("reminder-next-fire")?.focus();
      return;
    }
    if (escalationAt && new Date(escalationAt) <= firstSend) {
      setErrorMsg("Escalation must be after the first send.");
      setSubmitting(false);
      document.getElementById("reminder-escalation-at")?.focus();
      return;
    }

    const payload = {
      message,
      frequency,
      nextFire: new Date(nextFire).toISOString(),
      channel,
      repeatEvery: frequency === "CUSTOM" ? Number(repeatEvery) : undefined,
      repeatUnit: frequency === "CUSTOM" ? repeatUnit : undefined,
      ownerId: ownerId || undefined,
      escalationAt: escalationAt ? new Date(escalationAt).toISOString() : null,
    };

    const res = editingId
      ? await fetch(`/api/reminders/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    if (res.ok) {
      const data = await res.json();
      if (editingId) {
        setReminders((prev) =>
          prev
            .map((r) => (r.id === editingId ? data.reminder : r))
            .sort((a, b) => new Date(a.nextFire).getTime() - new Date(b.nextFire).getTime()),
        );
      } else {
        setReminders((prev) =>
          [data.reminder, ...prev].sort(
            (a, b) => new Date(a.nextFire).getTime() - new Date(b.nextFire).getTime(),
          ),
        );
      }
      const msg = editingId ? "Reminder updated successfully." : "Reminder created successfully.";
      setShowForm(false);
      resetForm();
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(""), 3000);
    } else {
      const data = await res.json().catch(() => null);
      setErrorMsg(data?.error || "Could not save the reminder.");
    }
    setSubmitting(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reminders/${deleteTarget}`, { method: "DELETE" });
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== deleteTarget));
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function reminderAction(id: string, action: "ACKNOWLEDGE" | "SNOOZE") {
    const payload: Record<string, string> = { action };
    if (action === "SNOOZE") {
      const reminder = reminders.find((item) => item.id === id);
      if (!reminder) return;
      setSnoozeTarget(reminder);
      setSnoozeUntil("");
      setErrorMsg("");
      return;
    }
    const response = await fetch(`/api/reminders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) return;
    const data = await response.json();
    setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, ...data.reminder } : reminder));
  }

  async function submitSnooze(event: React.FormEvent) {
    event.preventDefault();
    if (!snoozeTarget) return;
    const until = new Date(snoozeUntil);
    if (Number.isNaN(until.getTime()) || until <= new Date()) {
      setErrorMsg("Choose a future snooze time.");
      document.getElementById("snooze-until")?.focus();
      return;
    }
    setSubmitting(true);
    const response = await fetch(`/api/reminders/${snoozeTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SNOOZE", until: until.toISOString() }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) setErrorMsg(data?.error || "Could not snooze reminder");
    else {
      setReminders((current) => current.map((reminder) => reminder.id === snoozeTarget.id ? { ...reminder, ...data.reminder } : reminder));
      setSnoozeTarget(null);
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-20 w-full mb-4" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this reminder?"
        message="This cannot be undone"
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
      <FormDialog open={snoozeTarget !== null} title="Snooze reminder" description="Choose when this reminder should become due again." submitLabel="Snooze" loading={submitting} error={errorMsg} onClose={() => setSnoozeTarget(null)} onSubmit={submitSnooze}>
        <label htmlFor="snooze-until" className="block text-xs font-semibold text-text-secondary">Snooze until</label>
        <input id="snooze-until" autoFocus required type="datetime-local" value={snoozeUntil} onChange={(event) => setSnoozeUntil(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-bg-deep px-3 py-2 text-text-primary" />
      </FormDialog>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Bot <span className="font-display text-lime">Reminders</span>
        </h1>
        <button
          onClick={() => {
            if (showForm) {
              handleCancelForm();
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "New Reminder"}
        </button>
      </div>
      {errorMsg && !showForm && !snoozeTarget && <div role="alert" className="mb-4 rounded-lg border border-coral/20 bg-coral/8 px-4 py-3 text-sm text-coral">{errorMsg}</div>}

      {successMsg && (
        <div className="mb-4 p-4 rounded-lg bg-mint/8 border border-mint/20 text-mint text-sm">
          {successMsg}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.1em] text-text-secondary">
              {editingId ? "Edit Reminder" : "New Reminder"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={handleCancelForm}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Cancel edit
              </button>
            )}
          </div>
          <FormExample lines={["Message: Renew Supabase Pro plan", "Repeat: Every 2 weeks · Delivery: Telegram DM"]} />
          <div className="mb-4 rounded-lg border border-lime/15 bg-lime/5 px-4 py-3 text-sm text-text-secondary">
            This reminder is sent to every active admin.
          </div>
          {errorMsg && (
            <div className="mb-4 rounded-lg border border-coral/20 bg-coral/8 px-4 py-3 text-sm text-coral">
              {errorMsg}
            </div>
          )}
          <div className="mb-4">
            <label htmlFor="reminder-message" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Message
            </label>
            <textarea
              id="reminder-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Reminder message..."
              required
              rows={3}
              className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30 resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="reminder-frequency" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Frequency
              </label>
              <Dropdown
                id="reminder-frequency"
                value={frequency}
                options={[
                  { value: "ONCE", label: "Once" },
                  { value: "CUSTOM", label: "Repeat every…" },
                ]}
                onChange={setFrequency}
              />
            </div>
            <div>
              <label htmlFor="reminder-next-fire" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                First Send
              </label>
              <input
                type="datetime-local"
                id="reminder-next-fire"
                min={localDateTimeValue(new Date().toISOString())}
                value={nextFire}
                onChange={(e) => setNextFire(e.target.value)}
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label htmlFor="reminder-channel" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Delivery
              </label>
              <Dropdown
                id="reminder-channel"
                value={channel}
                options={[
                  { value: "BOTH", label: "Both" },
                  { value: "BOT", label: "Telegram DM" },
                  { value: "WEB", label: "In-app" },
                ]}
                onChange={setChannel}
              />
            </div>
          </div>
          {frequency === "CUSTOM" && (
            <div className="mb-4">
              <label htmlFor="reminder-repeat-every" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Repeat Every
              </label>
              <div className="grid max-w-xl grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3">
                <input
                  id="reminder-repeat-every"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={repeatEvery}
                  onChange={(e) => setRepeatEvery(e.target.value)}
                  required
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                />
                <Dropdown ariaLabel="Repeat unit"
                  value={repeatUnit}
                  options={[
                    { value: "MINUTE", label: "Minutes" },
                    { value: "HOUR", label: "Hours" },
                    { value: "DAY", label: "Days" },
                    { value: "WEEK", label: "Weeks" },
                    { value: "MONTH", label: "Months" },
                  ]}
                  onChange={setRepeatUnit}
                />
              </div>
            </div>
          )}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reminder-owner" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">Owner</label>
              <Dropdown id="reminder-owner" value={ownerId} options={[{ value: "", label: "Me" }, ...admins.map((admin) => ({ value: admin.id, label: admin.name, avatar: admin.photoUrl ?? null }))]} onChange={setOwnerId} />
            </div>
            <div>
              <label htmlFor="reminder-escalation-at" className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">Escalate if unacknowledged (optional)</label>
              <input id="reminder-escalation-at" type="datetime-local" min={nextFire || localDateTimeValue(new Date().toISOString())} value={escalationAt} onChange={(event) => setEscalationAt(event.target.value)} className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30" />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !message || !nextFire || (frequency === "CUSTOM" && !repeatEvery)}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting
              ? (editingId ? "Updating..." : "Creating...")
              : (editingId ? "Update Reminder" : "Create Reminder")}
          </button>
        </form>
      )}

      {reminders.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No reminders yet.</p>
          <p className="text-text-tertiary text-sm">
            Schedule one-time or repeating messages for all active admins.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reminders.map((rem) => (
            <div key={rem.id} className="card p-5 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium mb-2">{rem.message}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] ${FREQ_COLORS[rem.frequency] || "text-text-secondary"}`}
                  >
                    {reminderRepeatLabel(
                      rem.frequency as ReminderFrequency,
                      rem.repeatEvery,
                      rem.repeatUnit as ReminderRepeatUnit | null,
                    )}
                  </span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] ${CHANNEL_COLORS[rem.channel] || "text-text-secondary"}`}
                  >
                    {rem.channel === "BOT" ? "Telegram DM" : rem.channel === "WEB" ? "In-app" : "Both"}
                  </span>
                </div>
                <div className="text-text-tertiary text-xs mt-2">
                  Next: {new Date(rem.nextFire).toLocaleString()} · owner {rem.owner ? <TgUser name={rem.owner.name} telegramUser={rem.owner.telegramUser} photoUrl={rem.owner.photoUrl} size={18} /> : "admin"} · by <TgUser name={rem.createdBy.name} telegramUser={rem.createdBy.telegramUser} photoUrl={rem.createdBy.photoUrl} size={18} />
                </div>
                {rem.escalationAt && <div className="mt-1 text-[10px] text-amber">Escalates {new Date(rem.escalationAt).toLocaleString()}{rem.escalatedAt ? " · escalated" : ""}</div>}
                {rem.acknowledgedAt && <div className="mt-1 flex items-center gap-1 text-[10px] text-mint">Acknowledged by {rem.acknowledgedBy ? <TgUser name={rem.acknowledgedBy.name} telegramUser={rem.acknowledgedBy.telegramUser} photoUrl={rem.acknowledgedBy.photoUrl} size={18} nameClassName="!text-[10px] !text-mint" /> : "admin"}</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                {!rem.acknowledgedAt && <button onClick={() => reminderAction(rem.id, "ACKNOWLEDGE")} className="px-3 py-1 rounded-full text-xs font-semibold bg-mint/10 text-mint">Acknowledge</button>}
                <button onClick={() => reminderAction(rem.id, "SNOOZE")} className="px-3 py-1 rounded-full text-xs font-semibold bg-amber/10 text-amber">Snooze</button>
                <button
                  onClick={() => handleEdit(rem)}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-lime/10 text-lime hover:bg-lime/20 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeleteTarget(rem.id)}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
