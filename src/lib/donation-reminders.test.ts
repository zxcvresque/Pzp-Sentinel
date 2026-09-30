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
    expect(reminderDue(anchored, new Date("2026-09-15T19:59:59Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-09-15T20:00:00Z"))).toBe(true);
  });

  it("clamps a 31st anchor to shorter months", () => {
    const anchored = donor({
      donateReminderAnchorAt: new Date("2026-01-31T08:00:00Z"),
      lastDonateReminderAt: new Date("2026-01-31T08:00:00Z"),
    });
    expect(reminderDue(anchored, new Date("2026-02-27T10:00:00Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-02-28T20:00:00Z"))).toBe(true);
  });

  it("waits until the next morning when the grace period crosses midnight in IST", () => {
    const anchored = donor({ donateReminderTz: "Asia/Kolkata", donateReminderAnchorAt: new Date("2026-08-31T13:14:00Z") });
    expect(reminderDue(anchored, new Date("2026-10-01T01:13:59Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-10-01T01:14:00Z"))).toBe(true);
    expect(reminderDue({ ...anchored, lastDonateReminderAt: new Date("2026-10-01T01:14:00Z") }, new Date("2026-10-02T10:00:00Z"))).toBe(false);
  });

  it("suppresses a reminder when the renewal month was paid, even early", () => {
    const anchored = donor({ donateReminderAnchorAt: new Date("2026-08-15T08:00:00Z"), lastMonthlyDonationAt: new Date("2026-09-14T08:00:00Z") });
    expect(reminderDue(anchored, new Date("2026-09-15T20:00:00Z"))).toBe(false);
    expect(reminderDue(anchored, new Date("2026-10-15T20:00:00Z"))).toBe(true);
  });

  it("does not remind during the first payment month or duplicate a cycle", () => {
    const anchored = donor({ donateReminderAnchorAt: new Date("2026-08-15T08:00:00Z") });
    expect(reminderDue(anchored, new Date("2026-08-20T20:00:00Z"))).toBe(false);
    expect(reminderDue({ ...anchored, lastDonateReminderAt: new Date("2026-09-15T20:00:00Z") }, new Date("2026-09-20T20:00:00Z"))).toBe(false);
  });
});
