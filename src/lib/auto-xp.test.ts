import { expect, it } from "vitest";
import { computeAutoXp, type AutoXpPayment } from "./auto-xp";

const pay = (id: string, paymentDate: string, frequency = "ONE_TIME", amount = "5", currency = "USD"): AutoXpPayment => ({ id, paymentDate, frequency, amount, currency });
const at = (iso: string) => new Date(iso);

it("grants 30 days from the payment date", () => {
  const result = computeAutoXp([pay("a", "2026-11-01")], at("2026-11-10T00:00:00Z"));
  expect(result).toMatchObject({ activeUntil: "2026-12-01T00:00:00.000Z", graceUntil: "2026-12-01T00:00:00.000Z", active: true, inGrace: false });
  expect(computeAutoXp([pay("a", "2026-11-01")], at("2026-12-01T00:00:00Z")).active).toBe(false);
});
it("adds 30 days when the donor pays again before the window ends", () => {
  expect(computeAutoXp([pay("a", "2026-11-01"), pay("b", "2026-11-20")]).activeUntil).toBe("2026-12-31T00:00:00.000Z");
  // Two payments on the same day are two grants.
  expect(computeAutoXp([pay("a", "2026-11-01"), pay("b", "2026-11-01")]).activeUntil).toBe("2026-12-31T00:00:00.000Z");
});
it("starts a new window when the donor pays after it ran out", () => {
  expect(computeAutoXp([pay("a", "2026-08-01"), pay("b", "2026-11-01")]).activeUntil).toBe("2026-12-01T00:00:00.000Z");
});
it("keeps a monthly supporter on through BMC's 31-day months and late renewals ($6/month example)", () => {
  const monthly = ["2026-08-16", "2026-09-16", "2026-10-16", "2026-11-16"].map((date, index) => pay(`r${index}`, date, "MONTHLY", "6"));
  const result = computeAutoXp(monthly, at("2026-11-28T00:00:00Z"));
  expect(result).toMatchObject({ activeUntil: "2026-12-16T00:00:00.000Z", graceUntil: "2026-12-19T00:00:00.000Z", active: true });
  // On 16 Sep the 30-day window from 16 Aug has ended, but the grace keeps auto-XP on until the renewal arrives.
  expect(computeAutoXp(monthly.slice(0, 1), at("2026-09-16T12:00:00Z"))).toMatchObject({ active: true, inGrace: true });
  expect(computeAutoXp(monthly.slice(0, 1), at("2026-09-18T00:00:00Z")).active).toBe(false);
});
it("depends only on the payments, not their order or how often it is computed", () => {
  const payments = [pay("b", "2026-11-20"), pay("a", "2026-11-01"), pay("c", "2026-10-01")];
  expect(computeAutoXp(payments)).toEqual(computeAutoXp([...payments].reverse()));
  expect(computeAutoXp(payments).payments.map(payment => payment.id)).toEqual(["c", "a", "b"]);
});
it("reports nothing for a donor without verified payments", () => {
  expect(computeAutoXp([])).toMatchObject({ activeUntil: null, graceUntil: null, active: false, inGrace: false, payments: [] });
});
