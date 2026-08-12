import { describe, expect, it } from "vitest";
import {
  broadcastAudienceRoles,
  canSendBroadcastToTelegramGroup,
  parseBroadcastAudience,
  parseBroadcastRecipientMode,
  recipientMatchesAudience,
} from "./broadcast-audience";

describe("broadcast audience targeting", () => {
  it("accepts only known audiences and recipient modes", () => {
    expect(parseBroadcastAudience("DONORS")).toBe("DONORS");
    expect(parseBroadcastAudience("DEVS")).toBe("DEVS");
    expect(parseBroadcastAudience("EVERYONE")).toBe("EVERYONE");
    expect(parseBroadcastAudience("ADMINS")).toBeNull();
    expect(parseBroadcastRecipientMode("SELECTED")).toBe("SELECTED");
    expect(parseBroadcastRecipientMode("SOME")).toBeNull();
  });

  it("targets donor and developer roles without excluding multi-role members", () => {
    expect(broadcastAudienceRoles("EVERYONE")).toEqual(["DONOR", "DEV"]);
    expect(recipientMatchesAudience(["ADMIN", "DONOR"], "DONORS")).toBe(true);
    expect(recipientMatchesAudience(["ADMIN", "DEV"], "DEVS")).toBe(true);
    expect(recipientMatchesAudience(["ADMIN"], "EVERYONE")).toBe(false);
  });

  it("allows the donors group only for non-targeted donor-inclusive broadcasts", () => {
    expect(canSendBroadcastToTelegramGroup("DONORS", "ALL")).toBe(true);
    expect(canSendBroadcastToTelegramGroup("EVERYONE", "ALL")).toBe(true);
    expect(canSendBroadcastToTelegramGroup("DEVS", "ALL")).toBe(false);
    expect(canSendBroadcastToTelegramGroup("DONORS", "SELECTED")).toBe(false);
  });
});
