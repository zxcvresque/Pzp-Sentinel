"use client";

import type { DisplayCurrency } from "@/lib/currency-display";

export default function CurrencyToggle({
  value,
  onChange,
  exchangeRate,
}: {
  value: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  exchangeRate?: number | null;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
      {exchangeRate && (
        <span
          className="font-mono text-[10px] text-text-tertiary transition-opacity duration-200"
          style={{ opacity: value === "USD" ? 1 : 0 }}
        >
          1 USD = ₹{exchangeRate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
      )}
      <div className="relative flex items-center overflow-hidden rounded-full border border-[var(--border)] bg-black/10" aria-label="Display currency">
        <div
          className="absolute bottom-0 top-0 w-1/2 rounded-full bg-lime transition-transform duration-200 ease-out"
          style={{ transform: value === "USD" ? "translateX(100%)" : "translateX(0)" }}
        />
        {(["INR", "USD"] as const).map((currency) => (
        <button
          key={currency}
          type="button"
          aria-pressed={value === currency}
          onClick={() => onChange(currency)}
          className="relative z-10 flex items-center gap-1 px-3.5 py-2 font-mono text-[10px] uppercase tracking-[.08em] transition-colors"
          style={{
            color: value === currency ? "var(--bg-void)" : "var(--text-tertiary)",
            fontWeight: value === currency ? 700 : 400,
          }}
        >
          <span className="text-[11px]">{currency === "USD" ? "$" : "₹"}</span> {currency}
        </button>
        ))}
      </div>
    </div>
  );
}
