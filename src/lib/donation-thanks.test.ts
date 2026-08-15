import { describe, expect, it } from "vitest";
import { groupThanks } from "./donation-thanks";

describe("donation group tags", () => {
  it("marks one-time donations", () => {
    expect(groupThanks("Alex", 100, "INR", "ONE_TIME")).toMatch(/\n\n<blockquote>#onetime<\/blockquote>$/);
  });

  it("marks monthly donations", () => {
    expect(groupThanks("Alex", 100, "INR", "MONTHLY")).toMatch(/\n\n<blockquote>#monthly<\/blockquote>$/);
  });
});
