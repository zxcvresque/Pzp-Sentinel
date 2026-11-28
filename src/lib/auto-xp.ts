/**
 * Auto-XP window derived from a donor's verified, XP-eligible payments.
 *
 * Rule (v1): every payment grants 30 days. A payment made before the current
 * window ends extends it by 30 days; otherwise a new window starts on its
 * payment date. Dates are UTC calendar days, so the result depends only on the
 * payments themselves, never on when or how often Sentinel or Sentry saw them.
 * When the latest payment is monthly, auto-XP stays on for 3 more days so a
 * renewal BMC charges a day or two late (31-day months, retries) never causes
 * a gap. Policy such as a minimum amount is the consumer's: `payments` lists
 * exactly what was counted, so the same rule can be re-run on a subset.
 */
export const AUTO_XP_RULE = "30_DAYS_PER_PAYMENT_STACKED_V1";
export const AUTO_XP_DAYS = 30;
export const MONTHLY_GRACE_DAYS = 3;
const DAY = 86_400_000;

export type AutoXpPayment = { id: string; paymentDate: string; frequency: string; amount: string; currency: string };

export function computeAutoXp(payments: AutoXpPayment[], now = new Date()) {
  const counted = payments
    .filter(payment => /^\d{4}-\d{2}-\d{2}$/.test(payment.paymentDate) && Number.isFinite(Date.parse(`${payment.paymentDate}T00:00:00Z`)))
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.id.localeCompare(b.id));
  let end: number | null = null;
  for (const payment of counted) {
    const paid = Date.parse(`${payment.paymentDate}T00:00:00Z`);
    end = end !== null && paid < end ? end + AUTO_XP_DAYS * DAY : paid + AUTO_XP_DAYS * DAY;
  }
  const latest = counted.at(-1);
  const grace = end === null ? null : end + (latest?.frequency === "MONTHLY" ? MONTHLY_GRACE_DAYS * DAY : 0);
  const at = now.getTime();
  return {
    rule: AUTO_XP_RULE, daysPerPayment: AUTO_XP_DAYS, monthlyGraceDays: MONTHLY_GRACE_DAYS,
    /** Exclusive end of the paid window (UTC). */
    activeUntil: end === null ? null : new Date(end).toISOString(),
    /** Exclusive end including the monthly-renewal grace; equals activeUntil after a one-time payment. */
    graceUntil: grace === null ? null : new Date(grace).toISOString(),
    active: grace !== null && at < grace,
    inGrace: end !== null && grace !== null && at >= end && at < grace,
    /** Every verified, XP-eligible payment counted, oldest first. */
    payments: counted.map(({ id, paymentDate, frequency, amount, currency }) => ({ id, paymentDate, frequency, amount, currency })),
  };
}
