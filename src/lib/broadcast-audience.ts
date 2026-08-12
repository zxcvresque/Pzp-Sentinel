export const BROADCAST_AUDIENCES = ["DONORS", "DEVS", "EVERYONE"] as const;
export const BROADCAST_RECIPIENT_MODES = ["ALL", "SELECTED"] as const;

export type BroadcastAudience = typeof BROADCAST_AUDIENCES[number];
export type BroadcastRecipientMode = typeof BROADCAST_RECIPIENT_MODES[number];
export type BroadcastMemberRole = "DONOR" | "DEV";

export function parseBroadcastAudience(value: unknown): BroadcastAudience | null {
  return typeof value === "string" && BROADCAST_AUDIENCES.includes(value as BroadcastAudience)
    ? value as BroadcastAudience
    : null;
}

export function parseBroadcastRecipientMode(value: unknown): BroadcastRecipientMode | null {
  return typeof value === "string" && BROADCAST_RECIPIENT_MODES.includes(value as BroadcastRecipientMode)
    ? value as BroadcastRecipientMode
    : null;
}

export function broadcastAudienceRoles(audience: BroadcastAudience): BroadcastMemberRole[] {
  if (audience === "DONORS") return ["DONOR"];
  if (audience === "DEVS") return ["DEV"];
  return ["DONOR", "DEV"];
}

export function recipientMatchesAudience(roles: readonly string[], audience: BroadcastAudience): boolean {
  return broadcastAudienceRoles(audience).some((role) => roles.includes(role));
}

/**
 * A Telegram group post cannot honor individual recipient selection and the
 * configured group is specifically the donors/funds group.
 */
export function canSendBroadcastToTelegramGroup(
  audience: BroadcastAudience,
  recipientMode: BroadcastRecipientMode,
): boolean {
  return recipientMode === "ALL" && audience !== "DEVS";
}
