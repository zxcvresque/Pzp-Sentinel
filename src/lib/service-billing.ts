export const SERVICE_FREQUENCY_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly (3 months)" },
  { value: "HALF_YEARLY", label: "Every 6 months" },
  { value: "YEARLY", label: "Yearly" },
  { value: "CUSTOM", label: "Custom interval" },
] as const;

export const SERVICE_FREQUENCIES = SERVICE_FREQUENCY_OPTIONS.map((option) => option.value);
export const CUSTOM_REPEAT_UNITS = ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"] as const;

export type ServiceFrequency = (typeof SERVICE_FREQUENCY_OPTIONS)[number]["value"];
export type CustomRepeatUnit = (typeof CUSTOM_REPEAT_UNITS)[number];

export function isServiceFrequency(value: unknown): value is ServiceFrequency {
  return typeof value === "string" && SERVICE_FREQUENCIES.includes(value as ServiceFrequency);
}

export function isCustomRepeatUnit(value: unknown): value is CustomRepeatUnit {
  return typeof value === "string" && CUSTOM_REPEAT_UNITS.includes(value as CustomRepeatUnit);
}

export function serviceReminderRepeat(
  frequency: string | null | undefined,
  customRepeatEvery?: number | null,
  customRepeatUnit?: string | null,
) {
  if (frequency === "WEEKLY") return { repeatEvery: 1, repeatUnit: "WEEK" as const };
  if (frequency === "MONTHLY") return { repeatEvery: 1, repeatUnit: "MONTH" as const };
  if (frequency === "QUARTERLY") return { repeatEvery: 3, repeatUnit: "MONTH" as const };
  if (frequency === "HALF_YEARLY") return { repeatEvery: 6, repeatUnit: "MONTH" as const };
  if (frequency === "YEARLY") return { repeatEvery: 12, repeatUnit: "MONTH" as const };
  if (
    frequency === "CUSTOM"
    && Number.isInteger(customRepeatEvery)
    && Number(customRepeatEvery) > 0
    && isCustomRepeatUnit(customRepeatUnit)
  ) {
    return { repeatEvery: Number(customRepeatEvery), repeatUnit: customRepeatUnit };
  }
  return null;
}

export function nextServiceCycleDate(
  from: Date,
  frequency: string | null | undefined,
  customRepeatEvery?: number | null,
  customRepeatUnit?: string | null,
): Date {
  const date = new Date(from);
  const repeat = serviceReminderRepeat(frequency, customRepeatEvery, customRepeatUnit);
  if (!repeat) return date;
  if (repeat.repeatUnit === "MINUTE") date.setMinutes(date.getMinutes() + repeat.repeatEvery);
  if (repeat.repeatUnit === "HOUR") date.setHours(date.getHours() + repeat.repeatEvery);
  if (repeat.repeatUnit === "DAY") date.setDate(date.getDate() + repeat.repeatEvery);
  if (repeat.repeatUnit === "WEEK") date.setDate(date.getDate() + (repeat.repeatEvery * 7));
  if (repeat.repeatUnit === "MONTH") date.setMonth(date.getMonth() + repeat.repeatEvery);
  return date;
}

export function monthlyServiceCost(
  price: number,
  frequency: string | null | undefined,
  customRepeatEvery?: number | null,
  customRepeatUnit?: string | null,
) {
  if (frequency === "ONE_TIME" || frequency === "LIFETIME") return 0;
  const repeat = serviceReminderRepeat(frequency, customRepeatEvery, customRepeatUnit);
  if (!repeat) return frequency === "MONTHLY" ? price : 0;
  const cyclesPerMonth = repeat.repeatUnit === "MONTH" ? 1 / repeat.repeatEvery
    : repeat.repeatUnit === "WEEK" ? 52 / (12 * repeat.repeatEvery)
      : repeat.repeatUnit === "DAY" ? 365 / (12 * repeat.repeatEvery)
        : repeat.repeatUnit === "HOUR" ? (365 * 24) / (12 * repeat.repeatEvery)
          : (365 * 24 * 60) / (12 * repeat.repeatEvery);
  return price * cyclesPerMonth;
}
