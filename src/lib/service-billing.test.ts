import { describe, expect, it } from "vitest";
import { monthlyServiceCost, nextServiceCycleDate, SERVICE_FREQUENCY_OPTIONS, serviceReminderRepeat } from "./service-billing";

describe("service billing intervals", () => {
  it("offers quarterly, six-month and custom schedules", () => {
    expect(SERVICE_FREQUENCY_OPTIONS.map((option) => option.value)).toEqual([
      "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "CUSTOM",
    ]);
    expect(serviceReminderRepeat("QUARTERLY")).toEqual({ repeatEvery: 3, repeatUnit: "MONTH" });
    expect(serviceReminderRepeat("HALF_YEARLY")).toEqual({ repeatEvery: 6, repeatUnit: "MONTH" });
    expect(serviceReminderRepeat("CUSTOM", 10, "DAY")).toEqual({ repeatEvery: 10, repeatUnit: "DAY" });
  });

  it("advances renewal dates for the new schedules", () => {
    const start = new Date("2026-08-26T12:00:00.000Z");
    expect(nextServiceCycleDate(start, "QUARTERLY").toISOString()).toBe("2026-11-26T12:00:00.000Z");
    expect(nextServiceCycleDate(start, "HALF_YEARLY").toISOString()).toBe("2027-02-26T12:00:00.000Z");
    expect(nextServiceCycleDate(start, "CUSTOM", 10, "DAY").toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("normalizes recurring costs for dashboard totals", () => {
    expect(monthlyServiceCost(300, "QUARTERLY")).toBe(100);
    expect(monthlyServiceCost(600, "HALF_YEARLY")).toBe(100);
    expect(monthlyServiceCost(1200, "YEARLY")).toBe(100);
  });
});
