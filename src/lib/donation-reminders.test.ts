import { describe, expect, it } from "vitest";
import { reminderDue, type ReminderDonor } from "./donation-reminders";

function donor(overrides: Partial<ReminderDonor> = {}): ReminderDonor {
  return {
    donateReminderCadence: "MONTHLY",
    lastDonateReminderAt: null,
    donateReminderAnchorAt: null,
    donateReminderEveryN: null,
    donateReminderUnit: null,
    donateReminderTimeMin: 540,
    donateReminderTz: "UTC",
    ...overrides,
  };
}

describe("donation reminder schedule", () => {
  it("keeps unanchored monthly reminders on the 5th", () => {
    expect(reminderDue(donor(), new Date("2026-09-04T10:00:00Z"))).toBe(false);
    expect(reminderDue(donor(), new Date("2026-09-05T10:00:00Z"))).toBe(true);
  });

  it("uses the monthly donation day instead of the 5th", () => {
    const anchored = donor({
      donateReminderAnchorAt: new Date("2026-08-15T08:00:00Z"),
      lastDonateReminderAt: new Date("2026-08-15T08:00:00Z"),
    });
    expect(reminderDue(anchored, new Date("2026-09-14T10:00:00Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-09-15T10:00:00Z"))).toBe(true);
  });

  it("clamps a 31st anchor to shorter months", () => {
    const anchored = donor({
      donateReminderAnchorAt: new Date("2026-01-31T08:00:00Z"),
      lastDonateReminderAt: new Date("2026-01-31T08:00:00Z"),
    });
    expect(reminderDue(anchored, new Date("2026-02-27T10:00:00Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-02-28T10:00:00Z"))).toBe(true);
  });
});
