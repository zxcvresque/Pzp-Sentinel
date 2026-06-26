"use client";

import { useEffect, useState } from "react";

const OPTIONS: { value: string; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "CUSTOM", label: "Custom" },
  { value: "OFF", label: "Off" },
];

const UNITS: { value: string; label: string }[] = [
  { value: "DAY", label: "days" },
  { value: "WEEK", label: "weeks" },
  { value: "MONTH", label: "months" },
];

// Common zones offered in the picker; the donor's stored zone is prepended if not listed.
const TZONES = [
  "Asia/Kolkata",
  "UTC",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

function minToHHMM(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

const fieldCls =
  "bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-text-secondary focus:outline-none focus:border-[var(--border-hover)]";

/** Donor-facing control for donate-reminder cadence, time of day, and timezone. */
export default function DonateReminderCard() {
  const [cadence, setCadence] = useState<string | null>(null);
  const [everyN, setEveryN] = useState(1);
  const [unit, setUnit] = useState("WEEK");
  const [timeMin, setTimeMin] = useState(540); // 09:00
  const [tz, setTz] = useState("Asia/Kolkata");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const u = d?.user;
        if (!u) {
          setCadence("MONTHLY");
          return;
        }
        setCadence(u.donateReminderCadence ?? "MONTHLY");
        if (u.donateReminderEveryN) setEveryN(u.donateReminderEveryN);
        if (u.donateReminderUnit) setUnit(u.donateReminderUnit);
        if (typeof u.donateReminderTimeMin === "number") setTimeMin(u.donateReminderTimeMin);
        if (u.donateReminderTz) setTz(u.donateReminderTz);
      })
      .catch(() => setCadence("MONTHLY"));
  }, []);

  async function persist(patch: Record<string, unknown>, rollback: () => void) {
    setSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) rollback();
    } catch {
      rollback();
    } finally {
      setSaving(false);
    }
  }

  function chooseCadence(value: string) {
    const prev = { cadence, everyN, unit };
    setCadence(value);
    const patch: Record<string, unknown> = { donateReminderCadence: value };
    if (value === "CUSTOM") {
      // The API requires an interval + unit for CUSTOM; send current (or defaults).
      const n = everyN || 1;
      const u = unit || "WEEK";
      setEveryN(n);
      setUnit(u);
      patch.donateReminderEveryN = n;
      patch.donateReminderUnit = u;
    }
    void persist(patch, () => {
      setCadence(prev.cadence);
      setEveryN(prev.everyN);
      setUnit(prev.unit);
    });
  }

  function commitEveryN() {
    const n = Math.min(365, Math.max(1, Math.round(everyN || 1)));
    const prev = everyN;
    setEveryN(n);
    void persist({ donateReminderEveryN: n }, () => setEveryN(prev));
  }

  function chooseUnit(u: string) {
    const prev = unit;
    setUnit(u);
    void persist({ donateReminderUnit: u }, () => setUnit(prev));
  }

  function chooseTime(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const min = h * 60 + m;
    const prev = timeMin;
    setTimeMin(min);
    void persist({ donateReminderTimeMin: min }, () => setTimeMin(prev));
  }

  function chooseTz(z: string) {
    const prev = tz;
    setTz(z);
    void persist({ donateReminderTz: z }, () => setTz(prev));
  }

  if (cadence === null) return null;

  const tzOptions = TZONES.includes(tz) ? TZONES : [tz, ...TZONES];
  const showTiming = cadence !== "OFF";

  return (
    <div className="card p-4 sm:p-5 mb-6">
      <div className="flex flex-col gap-1 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Donation reminders
        </span>
        <span className="text-sm text-text-secondary">
          Get a friendly DM nudge to donate. Default is monthly — change it, set a custom schedule, or turn it off anytime.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const active = cadence === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => chooseCadence(o.value)}
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

      {cadence === "CUSTOM" && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-sm text-text-tertiary">Remind every</span>
          <input
            type="number"
            min={1}
            max={365}
            value={everyN}
            disabled={saving}
            onChange={(e) => setEveryN(Number(e.target.value))}
            onBlur={commitEveryN}
            className={`${fieldCls} w-16 text-center disabled:opacity-50`}
          />
          <select
            value={unit}
            disabled={saving}
            onChange={(e) => chooseUnit(e.target.value)}
            className={`${fieldCls} disabled:opacity-50`}
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {showTiming && (
        <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-[var(--border)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-tertiary">Send around</span>
            <input
              type="time"
              value={minToHHMM(timeMin)}
              disabled={saving}
              onChange={(e) => chooseTime(e.target.value)}
              style={{ colorScheme: "dark" }}
              className={`${fieldCls} disabled:opacity-50`}
            />
            <select
              value={tz}
              disabled={saving}
              onChange={(e) => chooseTz(e.target.value)}
              className={`${fieldCls} disabled:opacity-50`}
            >
              {tzOptions.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-text-tertiary">
            Times are in India Standard Time (IST) by default — pick another timezone above if you&apos;re elsewhere.
          </span>
        </div>
      )}
    </div>
  );
}
