import { describe, expect, it } from "vitest";
import { nextReminderFire, reminderRepeatLabel } from "./admin-reminders";

describe("admin reminder scheduling", () => {
  it("advances a custom hourly reminder without drifting", () => {
    const next = nextReminderFire(
      new Date("2026-08-15T08:00:00.000Z"),
      new Date("2026-08-15T15:15:00.000Z"),
      "CUSTOM",
      3,
      "HOUR",
    );
    expect(next?.toISOString()).toBe("2026-08-15T17:00:00.000Z");
  });

  it("clamps month-end repeats to a valid calendar date", () => {
    const next = nextReminderFire(
      new Date("2026-01-31T09:00:00.000Z"),
      new Date("2026-02-01T00:00:00.000Z"),
      "CUSTOM",
      1,
      "MONTH",
    );
    expect(next?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("keeps the original month-end anchor after a clamped month", () => {
    const next = nextReminderFire(
      new Date("2026-01-31T09:00:00.000Z"),
      new Date("2026-02-28T10:00:00.000Z"),
      "CUSTOM",
      1,
      "MONTH",
    );
    expect(next?.toISOString()).toBe("2026-03-31T09:00:00.000Z");
  });

  it("formats custom repeat labels", () => {
    expect(reminderRepeatLabel("CUSTOM", 1, "DAY")).toBe("Every 1 day");
    expect(reminderRepeatLabel("CUSTOM", 6, "HOUR")).toBe("Every 6 hours");
  });
});
