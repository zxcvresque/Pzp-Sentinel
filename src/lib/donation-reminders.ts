const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderDonor = {
  donateReminderCadence: string;
  lastDonateReminderAt: Date | null;
  donateReminderAnchorAt: Date | null;
  donateReminderEveryN: number | null;
  donateReminderUnit: string | null;
  donateReminderTimeMin: number;
  donateReminderTz: string;
};

export function localParts(date: Date, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    let hour = get("hour");
    if (hour === 24) hour = 0;
    return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Generic MONTHLY reminders retain the 5th-of-month behavior. Once a donor
 * explicitly chooses monthly giving, the payment date becomes the anchor and
 * the reminder fires on that day (or the month's last day for 29/30/31).
 */
export function reminderDue(donor: ReminderDonor, now: Date): boolean {
  const tz = donor.donateReminderTz || "Asia/Kolkata";
  const nowLocal = localParts(now, tz);
  const timeReached = nowLocal.hour * 60 + nowLocal.minute >= (donor.donateReminderTimeMin ?? 540);
  if (!timeReached) return false;

  const last = donor.lastDonateReminderAt;
  const cadence = donor.donateReminderCadence;
  if (cadence === "WEEKLY") return !last || now.getTime() - last.getTime() >= 7 * DAY_MS;
  if (cadence === "BIWEEKLY") return !last || now.getTime() - last.getTime() >= 14 * DAY_MS;
  if (cadence === "MONTHLY") {
    const anchor = donor.donateReminderAnchorAt;
    const dueDay = anchor
      ? Math.min(localParts(anchor, tz).day, daysInMonth(nowLocal.year, nowLocal.month))
      : 5;
    if (nowLocal.day < dueDay) return false;
    if (anchor) {
      const anchorLocal = localParts(anchor, tz);
      const monthsSinceDonation = (nowLocal.year - anchorLocal.year) * 12 + (nowLocal.month - anchorLocal.month);
      if (monthsSinceDonation < 1) return false;
    }
    if (!last) return true;
    const lastLocal = localParts(last, tz);
    return lastLocal.year !== nowLocal.year || lastLocal.month !== nowLocal.month;
  }
  if (cadence === "CUSTOM") {
    if (!last) return true;
    const n = donor.donateReminderEveryN ?? 1;
    const unit = donor.donateReminderUnit ?? "WEEK";
    if (unit === "DAY") return now.getTime() - last.getTime() >= n * DAY_MS;
    if (unit === "WEEK") return now.getTime() - last.getTime() >= n * 7 * DAY_MS;
    if (unit === "MONTH") {
      const lastLocal = localParts(last, tz);
      const monthsElapsed = (nowLocal.year - lastLocal.year) * 12 + (nowLocal.month - lastLocal.month);
      return monthsElapsed >= n;
    }
  }
  return false;
}
