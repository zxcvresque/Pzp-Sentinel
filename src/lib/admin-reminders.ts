export const REMINDER_FREQUENCIES = ["ONCE", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"] as const;
export const REMINDER_REPEAT_UNITS = ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"] as const;
export const REMINDER_CHANNELS = ["BOT", "WEB", "BOTH"] as const;

export type ReminderFrequency = typeof REMINDER_FREQUENCIES[number];
export type ReminderRepeatUnit = typeof REMINDER_REPEAT_UNITS[number];
export type ReminderChannel = typeof REMINDER_CHANNELS[number];

export function parseReminderFrequency(value: unknown): ReminderFrequency | null {
  return typeof value === "string" && REMINDER_FREQUENCIES.includes(value as ReminderFrequency)
    ? value as ReminderFrequency
    : null;
}

export function parseReminderRepeatUnit(value: unknown): ReminderRepeatUnit | null {
  return typeof value === "string" && REMINDER_REPEAT_UNITS.includes(value as ReminderRepeatUnit)
    ? value as ReminderRepeatUnit
    : null;
}

export function parseReminderChannel(value: unknown): ReminderChannel | null {
  return typeof value === "string" && REMINDER_CHANNELS.includes(value as ReminderChannel)
    ? value as ReminderChannel
    : null;
}

export function reminderRepeatLabel(
  frequency: ReminderFrequency,
  repeatEvery?: number | null,
  repeatUnit?: ReminderRepeatUnit | null,
) {
  if (frequency === "ONCE") return "Once";
  if (frequency === "DAILY") return "Every day";
  if (frequency === "WEEKLY") return "Every week";
  if (frequency === "MONTHLY") return "Every month";
  if (!repeatEvery || !repeatUnit) return "Custom repeat";
  const unit = repeatUnit.toLowerCase();
  return `Every ${repeatEvery} ${unit}${repeatEvery === 1 ? "" : "s"}`;
}

function addMonthsClamped(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
    result.getHours(),
    result.getMinutes(),
    result.getSeconds(),
    result.getMilliseconds(),
  ).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

/** Return the next scheduled occurrence strictly after `now`, without drift. */
export function nextReminderFire(
  scheduledAt: Date,
  now: Date,
  frequency: ReminderFrequency,
  repeatEvery?: number | null,
  repeatUnit?: ReminderRepeatUnit | null,
) {
  let every = 1;
  let unit: ReminderRepeatUnit;

  if (frequency === "DAILY") unit = "DAY";
  else if (frequency === "WEEKLY") unit = "WEEK";
  else if (frequency === "MONTHLY") unit = "MONTH";
  else if (frequency === "CUSTOM" && repeatEvery && repeatEvery > 0 && repeatUnit) {
    every = repeatEvery;
    unit = repeatUnit;
  } else {
    return null;
  }

  if (unit !== "MONTH") {
    const unitMs = {
      MINUTE: 60_000,
      HOUR: 60 * 60_000,
      DAY: 24 * 60 * 60_000,
      WEEK: 7 * 24 * 60 * 60_000,
    }[unit];
    const intervalMs = every * unitMs;
    const elapsed = now.getTime() - scheduledAt.getTime();
    const intervals = Math.max(1, Math.floor(elapsed / intervalMs) + 1);
    return new Date(scheduledAt.getTime() + intervals * intervalMs);
  }

  const monthGap = (now.getFullYear() - scheduledAt.getFullYear()) * 12
    + now.getMonth() - scheduledAt.getMonth();
  let jumps = Math.max(1, Math.floor(monthGap / every));
  let candidate = addMonthsClamped(scheduledAt, jumps * every);
  while (candidate <= now) {
    jumps += 1;
    candidate = addMonthsClamped(scheduledAt, jumps * every);
  }
  return candidate;
}
