// Administrative authority is intentionally code-owned. Adding or removing an
// immutable administrator requires a reviewed deployment instead of a UI click.
export const IMMUTABLE_ADMIN_TELEGRAM_IDS = new Set([
  "1800754304",
]);

export function isImmutableAdmin(telegramId: string) {
  return IMMUTABLE_ADMIN_TELEGRAM_IDS.has(telegramId);
}
