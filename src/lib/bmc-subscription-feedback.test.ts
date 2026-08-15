import { describe, expect, it } from "vitest";
import {
  bmcFeedbackKeyboard,
  isBmcCancellationEvent,
  shouldPromptBmcDonor,
} from "./bmc-subscription-feedback";

describe("BMC subscription feedback", () => {
  it("starts the questionnaire only for recurring cancellation events", () => {
    expect(isBmcCancellationEvent("recurring_donation.cancelled")).toBe(true);
    expect(isBmcCancellationEvent("membership.cancelled")).toBe(true);
    expect(isBmcCancellationEvent("membership.paused")).toBe(false);
    expect(isBmcCancellationEvent("recurring_donation.updated")).toBe(false);
  });

  it("creates private callback buttons scoped to the feedback record", () => {
    expect(bmcFeedbackKeyboard("feedback_123")).toEqual({
      inline_keyboard: [[
        { text: "Yes", callback_data: "bmcfb:wanted:yes:feedback_123" },
        { text: "No", callback_data: "bmcfb:wanted:no:feedback_123" },
      ]],
    });
  });

  it("prompts only an identified donor for a live cancellation", () => {
    expect(shouldPromptBmcDonor("recurring_donation.cancelled", true, "donor_1")).toBe(true);
    expect(shouldPromptBmcDonor("recurring_donation.cancelled", true, null)).toBe(false);
    expect(shouldPromptBmcDonor("recurring_donation.cancelled", false, "donor_1")).toBe(false);
    expect(shouldPromptBmcDonor("recurring_donation.updated", true, "donor_1")).toBe(false);
  });
});
