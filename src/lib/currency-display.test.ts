import { describe, expect, it } from "vitest";
import { convertCurrencyAmount, currencyForCountry, formatCurrencyAmount } from "./currency-display";

describe("donor currency display", () => {
  it("defaults India to INR and every other or unknown country to USD", () => {
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("in")).toBe("INR");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry(null)).toBe("USD");
  });

  it("converts both directions using the live USD to INR rate", () => {
    expect(convertCurrencyAmount(6, "USD", "INR", 84)).toBe(504);
    expect(convertCurrencyAmount(840, "INR", "USD", 84)).toBe(10);
    expect(convertCurrencyAmount(6, "USD", "USD", 84)).toBe(6);
  });

  it("formats the selected display currency", () => {
    expect(formatCurrencyAmount(6, "USD")).toBe("$6");
    expect(formatCurrencyAmount(504.5, "INR")).toContain("₹504.50");
  });
});
