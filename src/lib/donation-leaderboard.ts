export function isEligibleLeaderboardDonation(input: {
  fromUserId: string | null;
  fromUserRoles: readonly string[];
  createdById: string;
  providerCaptured: boolean;
}) {
  if (!input.fromUserId || !input.fromUserRoles.includes("DONOR")) return false;

  // An administrator manually recording income without choosing a donor must
  // not become the donor merely because they created the ledger entry. Signed
  // provider attribution remains authoritative for admins who are also donors.
  const adminSelfNoted = input.createdById === input.fromUserId
    && input.fromUserRoles.includes("ADMIN")
    && !input.providerCaptured;
  return !adminSelfNoted;
}
