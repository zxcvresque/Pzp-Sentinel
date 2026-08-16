import { describe, expect, it } from "vitest";
import { isEligibleLeaderboardDonation } from "./donation-leaderboard";

describe("donation leaderboard eligibility", () => {
  it("includes provider-captured and explicitly attributed donor payments", () => {
    expect(isEligibleLeaderboardDonation({
      fromUserId: "donor-1",
      fromUserRoles: ["DONOR"],
      createdById: "donor-1",
      providerCaptured: false,
    })).toBe(true);
    expect(isEligibleLeaderboardDonation({
      fromUserId: "donor-1",
      fromUserRoles: ["DONOR"],
      createdById: "admin-1",
      providerCaptured: false,
    })).toBe(true);
  });

  it("excludes admin self-notes and users without the donor role", () => {
    expect(isEligibleLeaderboardDonation({
      fromUserId: "admin-1",
      fromUserRoles: ["ADMIN", "DONOR"],
      createdById: "admin-1",
      providerCaptured: false,
    })).toBe(false);
    expect(isEligibleLeaderboardDonation({
      fromUserId: "admin-1",
      fromUserRoles: ["ADMIN"],
      createdById: "admin-1",
      providerCaptured: true,
    })).toBe(false);
  });

  it("keeps signed provider attribution authoritative for an admin donor", () => {
    expect(isEligibleLeaderboardDonation({
      fromUserId: "admin-donor-1",
      fromUserRoles: ["ADMIN", "DONOR"],
      createdById: "admin-donor-1",
      providerCaptured: true,
    })).toBe(true);
  });
});
