const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderDonor = {
  donateReminderCadence: string;
  lastDonateReminderAt: Date | null;
  donateReminderAnchorAt: Date | null;
  donateReminderEveryN: number | null;
  donateReminderUnit: string | null;
  donateReminderTimeMin: number;
  donateReminderTz: string;
  lastMonthlyDonationAt?: Date | null;
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

// Add calendar months in the donor's timezone, preserving the payment time.
function monthlyPaymentAt(anchor: Date, months: number, tz: string) {
  const parts = localParts(anchor, tz);
  const month = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const target = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(),
    Math.min(parts.day, daysInMonth(month.getUTCFullYear(), month.getUTCMonth() + 1)),
    parts.hour, parts.minute, anchor.getUTCSeconds(), anchor.getUTCMilliseconds());
  let result = target;
  for (let i = 0; i < 3; i++) {
    const local = localParts(new Date(result), tz);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute,
      anchor.getUTCSeconds(), anchor.getUTCMilliseconds());
    result += target - represented;
  }
  return result;
}

/** Anchored monthly giving waits 12 hours for payment; other cadences use the chosen time. */
export function reminderDue(donor: ReminderDonor, now: Date): boolean {
  const tz = donor.donateReminderTz || "Asia/Kolkata";
  const nowLocal = localParts(now, tz);
  if (donor.donateReminderCadence === "MONTHLY" && donor.donateReminderAnchorAt) {
    const anchor = donor.donateReminderAnchorAt;
    const anchorLocal = localParts(anchor, tz);
    let cycle = (nowLocal.year - anchorLocal.year) * 12 + nowLocal.month - anchorLocal.month;
    let expected = monthlyPaymentAt(anchor, cycle, tz);
    let due = expected + 12 * 60 * 60 * 1000;
    if (now.getTime() < due) {
      cycle--;
      expected = monthlyPaymentAt(anchor, cycle, tz);
      due = expected + 12 * 60 * 60 * 1000;
    }
    if (cycle < 1 || now.getTime() < due) return false;
    if (donor.lastMonthlyDonationAt) {
      const paid = localParts(donor.lastMonthlyDonationAt, tz);
      const scheduled = localParts(new Date(expected), tz);
      if (paid.year * 12 + paid.month >= scheduled.year * 12 + scheduled.month) return false;
    }
    return !donor.lastDonateReminderAt || donor.lastDonateReminderAt.getTime() < due;
  }
  const timeReached = nowLocal.hour * 60 + nowLocal.minute >= (donor.donateReminderTimeMin ?? 540);
  if (!timeReached) return false;

  const last = donor.lastDonateReminderAt;
  const cadence = donor.donateReminderCadence;
  if (cadence === "WEEKLY") return !last || now.getTime() - last.getTime() >= 7 * DAY_MS;
  if (cadence === "BIWEEKLY") return !last || now.getTime() - last.getTime() >= 14 * DAY_MS;
  if (cadence === "MONTHLY") {
    if (nowLocal.day < 5) return false;
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
