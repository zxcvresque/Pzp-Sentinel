import { describe, expect, it } from "vitest";
import { donorHandle, groupThanks } from "./donation-thanks";

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
