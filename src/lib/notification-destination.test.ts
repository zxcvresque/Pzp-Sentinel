import { describe, expect, it } from "vitest";
import { notificationDestination } from "./notification-destination";

describe("notification destinations", () => {
  it.each(["TX_PENDING", "TX_APPROVED", "TX_REJECTED"])(
    "routes donor %s notifications to the donor overview",
    (type) => {
      expect(notificationDestination({ type, roles: ["DONOR"] })).toBe("/donor");
    },
  );

  it("keeps administrator transaction notifications in transaction management", () => {
    expect(notificationDestination({ type: "TX_APPROVED", roles: ["ADMIN"] }))
      .toBe("/admin/transactions");
  });

  it("opens the exact pending transaction when the notification identifies it", () => {
    expect(notificationDestination({ type: "TX_PENDING", roles: ["ADMIN"], entityId: "tx/renewal" }))
      .toBe("/admin/transactions?transactionId=tx%2Frenewal");
  });

  it.each(["VPS_ALERT_SETTINGS", "VPS_ALERT"])(
    "routes developer %s notifications to VPS preferences",
    (type) => {
      expect(notificationDestination({ type, roles: ["DEV"], entityId: "vps_1" }))
        .toBe("/dev/vps");
    },
  );

  it("routes administrator VPS alerts to VPS management", () => {
    expect(notificationDestination({ type: "VPS_ALERT", roles: ["ADMIN"], entityId: "vps_1" }))
      .toBe("/admin/vps");
  });
});
