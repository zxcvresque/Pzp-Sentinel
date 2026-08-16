export function isEligibleDonationAnnouncement(input: {
  status: string;
  direction: string;
  type: string;
  isTest: boolean;
  voidedAt: Date | null;
  fromUserId: string | null;
  fromUserRoles: readonly string[];
  createdById: string;
  providerCaptured: boolean;
}) {
  return input.status === "APPROVED"
    && input.direction === "IN"
    && input.type === "DONATION"
    && !input.isTest
    && !input.voidedAt
    && Boolean(input.fromUserId)
    && input.fromUserRoles.includes("DONOR")
    && (input.providerCaptured || input.createdById === input.fromUserId);
}
