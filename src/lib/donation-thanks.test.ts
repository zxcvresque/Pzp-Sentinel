import { describe, expect, it } from "vitest";
import {
  DONATION_REMINDER_VARIANT_COUNTS,
  donateReminderMessage,
  donorHandle,
  groupThanks,
  monthlyDonationReminderGroupMessage,
} from "./donation-thanks";

describe("donation group tags", () => {
  it("marks one-time donations", () => {
    const message = groupThanks("Alex", 100, "INR", "ONE_TIME");
    expect(message).toMatch(/^<b>.*Alex.*₹100.*[.!?]+<\/b>/);
    expect(message).toMatch(/\n\n<blockquote>#onetime<\/blockquote>$/);
  });

  it("marks monthly donations", () => {
    expect(groupThanks("Alex", 100, "INR", "MONTHLY")).toMatch(/\n\n<blockquote>#monthly<\/blockquote>$/);
  });

  it("places a special statement in a bold quote above the thank-you", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      expect(groupThanks("Alex", 1000, "INR", "ONE_TIME")).toMatch(
        /^<blockquote><b>🚨 LEGEND ALERT 🚨<\/b><\/blockquote>\n<b>Alex donated ₹1000!<\/b> The crew is speechless\./,
      );
    } finally {
      Math.random = originalRandom;
    }
  });

  it("omits blank and placeholder Telegram usernames for every donor", () => {
    expect(donorHandle("Varad", "-")).toBe("Varad");
    expect(donorHandle("Ghanshyam", "")).toBe("Ghanshyam");
    expect(donorHandle("Alex", "@alex_user")).toBe("Alex (@alex_user)");
  });
});

describe("donation reminder copy", () => {
  it("provides 15 distinct, personalized DM variants with preference guidance", () => {
    expect(DONATION_REMINDER_VARIANT_COUNTS.dm).toBe(15);
    const messages = Array.from({ length: 15 }, (_, variant) => donateReminderMessage("Alex", false, variant));
    expect(new Set(messages).size).toBe(15);
    for (const message of messages) {
      expect(message).toContain("Alex");
      expect(message).toContain("Profile → Donation reminders");
      expect(message).not.toMatch(/\{name\}|\{user\}/);
      expect(message).not.toContain("first reminder");
    }
  });

  it("keeps the first-reminder explanation for every DM variant", () => {
    for (let variant = 0; variant < 15; variant++) {
      expect(donateReminderMessage("Alex", true, variant)).toContain("This is your first reminder");
    }
  });

  it("provides 15 distinct monthly group variants with the donor handle and tag", () => {
    expect(DONATION_REMINDER_VARIANT_COUNTS.group).toBe(15);
    const messages = Array.from({ length: 15 }, (_, variant) =>
      monthlyDonationReminderGroupMessage("Alex (@alex_user)", variant));
    expect(new Set(messages).size).toBe(15);
    for (const message of messages) {
      expect(message).toContain("Alex (@alex_user)");
      expect(message).toMatch(/\n\n#monthly$/);
      expect(message).not.toMatch(/\{name\}|\{user\}/);
      expect(message).not.toContain("Profile → Donation reminders");
    }
  });

  it("escapes donor-provided HTML in every reminder variant", () => {
    for (let variant = 0; variant < 15; variant++) {
      expect(donateReminderMessage("Alex <b>& crew</b>", false, variant))
        .toContain("Alex &lt;b&gt;&amp; crew&lt;/b&gt;");
      expect(monthlyDonationReminderGroupMessage("Alex <b>& crew</b> (@alex_user)", variant))
        .toContain("Alex &lt;b&gt;&amp; crew&lt;/b&gt; (@alex_user)");
    }
  });
});
