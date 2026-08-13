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
    expect(parseBroadcastAudience("ADMINS")).toBe("ADMINS");
    expect(parseBroadcastRecipientMode("SELECTED")).toBe("SELECTED");
    expect(parseBroadcastRecipientMode("SOME")).toBeNull();
  });

  it("targets donor and developer roles without excluding multi-role members", () => {
    expect(broadcastAudienceRoles("EVERYONE")).toEqual(["ADMIN", "DONOR", "DEV"]);
    expect(recipientMatchesAudience(["ADMIN"], "ADMINS")).toBe(true);
    expect(recipientMatchesAudience(["ADMIN", "DONOR"], "DONORS")).toBe(true);
    expect(recipientMatchesAudience(["ADMIN", "DEV"], "DEVS")).toBe(true);
    expect(recipientMatchesAudience(["ADMIN"], "EVERYONE")).toBe(true);
  });

  it("allows the donors group only for non-targeted donor-inclusive broadcasts", () => {
    expect(canSendBroadcastToTelegramGroup("DONORS", "ALL")).toBe(true);
    expect(canSendBroadcastToTelegramGroup("EVERYONE", "ALL")).toBe(true);
    expect(canSendBroadcastToTelegramGroup("DEVS", "ALL")).toBe(false);
    expect(canSendBroadcastToTelegramGroup("ADMINS", "ALL")).toBe(false);
    expect(canSendBroadcastToTelegramGroup("DONORS", "SELECTED")).toBe(false);
  });
});
