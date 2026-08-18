export const RAZORPAY_CHECKOUT_TIMEOUT_SECONDS = 15 * 60;
export const RAZORPAY_MONTHLY_TOTAL_COUNT = 5 * 12;

const RAZORPAY_SUBSCRIPTION_AUTH_WINDOW_SECONDS = 30 * 60;

export function razorpaySubscriptionExpireBy(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000) + RAZORPAY_SUBSCRIPTION_AUTH_WINDOW_SECONDS;
}
