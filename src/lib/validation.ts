export const USER_ROLES = ["ADMIN", "DONOR", "DEV"] as const;
export const USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export function trimmedString(value: unknown, options: { min?: number; max?: number } = {}) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < (options.min ?? 0) || normalized.length > (options.max ?? Number.MAX_SAFE_INTEGER)) return null;
  return normalized;
}

export function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : null;
}

export function positiveAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function validDate(value: unknown) {
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function httpUrl(value: unknown) {
  const normalized = trimmedString(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isTelegramId(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,20}$/.test(value);
}

export function normalizeTelegramUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@/, "");
  if (!normalized) return "";
  return /^[A-Za-z0-9_]{5,32}$/.test(normalized) ? normalized : null;
}
