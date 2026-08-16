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
