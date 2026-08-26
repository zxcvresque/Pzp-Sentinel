import { describe, expect, it } from "vitest";
import { linkedServiceEditFields } from "./transaction-service-edit";

describe("transaction linked-service edit hydration", () => {
  it("restores billing, advanced metadata and secure-access fields without exposing secrets", () => {
    const fields = linkedServiceEditFields({
      id: "svc-vps",
      name: "VPS",
      category: "Infrastructure",
      frequency: "HALF_YEARLY",
      expiryDate: "2027-02-26T00:00:00.000Z",
      planUrl: "https://provider.example/dashboard",
      autoRenew: true,
      columns: [
        { key: "provider", label: "Provider" },
        { key: "region", label: "Region" },
      ],
      entries: [{ provider: "Example Host", region: "Mumbai" }],
      credentials: [
        { id: "cred-ip", platform: "VPS", label: "Host/IP", expiresAt: null },
        { id: "cred-ssh", platform: "VPS", label: "Password or SSH key", expiresAt: "2027-01-01T00:00:00.000Z" },
      ],
    });

    expect(fields).toMatchObject({
      serviceId: "svc-vps",
      serviceFrequency: "HALF_YEARLY",
      serviceRenewal: "2027-02-26",
      serviceMetadata: { provider: "Example Host", region: "Mumbai" },
      serviceAutoRenew: true,
    });
    expect(fields.credentials).toEqual([
      { id: "cred-ip", platform: "VPS", label: "Host/IP", value: "", expiresAt: "" },
      { id: "cred-ssh", platform: "VPS", label: "Password or SSH key", value: "", expiresAt: "2027-01-01" },
    ]);
  });
});
