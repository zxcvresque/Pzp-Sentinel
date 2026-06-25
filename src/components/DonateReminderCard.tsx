"use client";

import { useEffect, useState } from "react";

const OPTIONS: { value: string; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "OFF", label: "Off" },
];

/** Donor-facing control for the donate-reminder cadence (default monthly). */
export default function DonateReminderCard() {
  const [cadence, setCadence] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCadence(d?.user?.donateReminderCadence ?? "MONTHLY"))
      .catch(() => setCadence("MONTHLY"));
  }, []);

  async function update(value: string) {
    const prev = cadence;
    setCadence(value);
    setSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donateReminderCadence: value }),
      });
      if (!res.ok) setCadence(prev);
    } catch {
      setCadence(prev);
    } finally {
      setSaving(false);
    }
  }

  if (cadence === null) return null;

  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex flex-col gap-1 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Donation reminders
        </span>
        <span className="text-sm text-text-secondary">
          Get a friendly DM nudge to donate. Default is monthly — change it or turn it off anytime.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const active = cadence === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => update(o.value)}
              disabled={saving}
              className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                active
                  ? "bg-amber text-bg-void border-amber"
                  : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
