import { describe, expect, it } from "vitest";
import { isEligibleDonationAnnouncement } from "./donation-announcement-policy";

const eligible = {
  status: "APPROVED",
  direction: "IN",
  type: "DONATION",
  isTest: false,
  voidedAt: null,
  fromUserId: "donor-1",
  fromUserRoles: ["DONOR"],
  createdById: "donor-1",
  providerCaptured: false,
};

describe("funds-group donation announcements", () => {
  it("allows a donor's own approved donation", () => {
    expect(isEligibleDonationAnnouncement(eligible)).toBe(true);
  });

  it("allows a provider-captured donation attributed to a donor", () => {
    expect(isEligibleDonationAnnouncement({ ...eligible, createdById: "admin-1", providerCaptured: true })).toBe(true);
  });

  it("rejects admin-noted, unmatched, test, and non-donor entries", () => {
    expect(isEligibleDonationAnnouncement({ ...eligible, createdById: "admin-1" })).toBe(false);
    expect(isEligibleDonationAnnouncement({ ...eligible, fromUserId: null })).toBe(false);
    expect(isEligibleDonationAnnouncement({ ...eligible, isTest: true })).toBe(false);
    expect(isEligibleDonationAnnouncement({ ...eligible, fromUserRoles: ["ADMIN"] })).toBe(false);
  });
});
