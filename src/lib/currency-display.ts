export type DisplayCurrency = "USD" | "INR";

export function convertCurrencyAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: DisplayCurrency,
  usdToInr: number | null,
): number {
  if (fromCurrency === toCurrency) return amount;
  if (!usdToInr || !Number.isFinite(usdToInr) || usdToInr <= 0) return amount;
  if (fromCurrency === "USD" && toCurrency === "INR") return amount * usdToInr;
  if (fromCurrency === "INR" && toCurrency === "USD") return amount / usdToInr;
  return amount;
}

export function formatCurrencyAmount(amount: number, currency: DisplayCurrency): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function currencyForCountry(countryCode: string | null | undefined): DisplayCurrency {
  return countryCode?.trim().toUpperCase() === "IN" ? "INR" : "USD";
}

/**
 * What a BMC supporter paid in their own currency (e.g. "₹2,500.00" for a
 * $25.85 credit), or null when it is the same as the booked amount or unknown.
 */
export function supporterPaidLabel(tx: { currency: string; bmcSupporterAmount?: string | number | null; bmcSupporterCurrency?: string | null }) {
  if (!tx.bmcSupporterCurrency || tx.bmcSupporterAmount === null || tx.bmcSupporterAmount === undefined || tx.bmcSupporterCurrency === tx.currency) return null;
  try {
    return new Intl.NumberFormat(tx.bmcSupporterCurrency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: tx.bmcSupporterCurrency }).format(Number(tx.bmcSupporterAmount));
  } catch {
    return `${tx.bmcSupporterAmount} ${tx.bmcSupporterCurrency}`;
  }
}
