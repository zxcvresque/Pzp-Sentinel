import type { DonationFrequency } from "@/generated/prisma/enums";

export function parseDonationFrequency(value: unknown): DonationFrequency {
  return value === "MONTHLY" ? "MONTHLY" : "ONE_TIME";
}

export function donationFrequencyTag(frequency: string): "#monthly" | "#onetime" {
  return frequency === "MONTHLY" ? "#monthly" : "#onetime";
}

export function monthlyReminderUpdate(frequency: string, donatedAt: Date) {
  if (frequency !== "MONTHLY") return undefined;
  return {
    donateReminderCadence: "MONTHLY" as const,
    donateReminderAnchorAt: donatedAt,
    // Prevent the generic reminder job from firing again in the donation month.
    lastDonateReminderAt: donatedAt,
  };
}
