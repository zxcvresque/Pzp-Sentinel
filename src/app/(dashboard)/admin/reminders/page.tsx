"use client";

import { useEffect, useState } from "react";
import Dropdown from "@/components/Dropdown";

interface Reminder {
  id: string;
  message: string;
  frequency: string;
  nextFire: string;
  channel: string;
  recipientRoles: string[];
  createdBy: { name: string };
  createdAt: string;
}

const FREQ_COLORS: Record<string, string> = {
  ONCE: "text-text-tertiary",
  DAILY: "text-cyan",
  WEEKLY: "text-violet",
  MONTHLY: "text-amber",
};

const CHANNEL_COLORS: Record<string, string> = {
  BOT: "text-cyan",
  WEB: "text-blue",
  BOTH: "text-mint",
};

const ROLES = ["ADMIN", "DONOR", "DEV"] as const;

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [frequency, setFrequency] = useState("ONCE");
  const [nextFire, setNextFire] = useState("");
  const [channel, setChannel] = useState("BOTH");
  const [recipientRoles, setRecipientRoles] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/reminders")
      .then((r) => r.json())
      .then((data) => setReminders(data.reminders || []))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setMessage("");
    setFrequency("ONCE");
    setNextFire("");
    setChannel("BOTH");
    setRecipientRoles([]);
    setEditingId(null);
  }

  function toggleRole(role: string) {
    setRecipientRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function handleEdit(rem: Reminder) {
    setEditingId(rem.id);
    setMessage(rem.message);
    setFrequency(rem.frequency);
    setNextFire(rem.nextFire.slice(0, 16));
    setChannel(rem.channel);
    setRecipientRoles(rem.recipientRoles);
    setShowForm(true);
  }

  function handleCancelForm() {
    setShowForm(false);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const payload = { message, frequency, nextFire, channel, recipientRoles };

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
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this reminder?")) return;

    const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    if (res.ok) {
      setReminders((prev) => prev.filter((r) => r.id !== id));
    }
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
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Message
            </label>
            <textarea
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
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Frequency
              </label>
              <Dropdown
                value={frequency}
                options={[
                  { value: "ONCE", label: "Once" },
                  { value: "DAILY", label: "Daily" },
                  { value: "WEEKLY", label: "Weekly" },
                  { value: "MONTHLY", label: "Monthly" },
                ]}
                onChange={setFrequency}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Next Fire
              </label>
              <input
                type="datetime-local"
                value={nextFire}
                onChange={(e) => setNextFire(e.target.value)}
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Channel
              </label>
              <Dropdown
                value={channel}
                options={[
                  { value: "BOTH", label: "Both" },
                  { value: "BOT", label: "Bot" },
                  { value: "WEB", label: "Web" },
                ]}
                onChange={setChannel}
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Recipient Roles
            </label>
            <div className="flex gap-3">
              {ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipientRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="accent-lime"
                  />
                  <span className="font-mono text-xs text-text-secondary">{role}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !message || !nextFire}
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
            Schedule recurring bot messages for subscription renewals and community announcements.
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
                    {rem.frequency}
                  </span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] ${CHANNEL_COLORS[rem.channel] || "text-text-secondary"}`}
                  >
                    {rem.channel}
                  </span>
                  {rem.recipientRoles.map((role) => (
                    <span
                      key={role}
                      className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[var(--bg-deep)] text-text-secondary"
                    >
                      {role}
                    </span>
                  ))}
                </div>
                <div className="text-text-tertiary text-xs mt-2">
                  Next: {new Date(rem.nextFire).toLocaleString()} · by {rem.createdBy.name}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleEdit(rem)}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-lime/10 text-lime hover:bg-lime/20 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(rem.id)}
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
