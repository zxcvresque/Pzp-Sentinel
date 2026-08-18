import { describe, expect, it } from "vitest";
import { resolveTransactionAccess } from "./transaction-access";

describe("transaction access scope", () => {
  it("keeps donor-only accounts scoped to themselves", () => {
    expect(resolveTransactionAccess(["DONOR"], null)).toMatchObject({
      allowed: true,
      selfScoped: true,
      adminLedger: false,
    });
  });

  it("uses the full ledger for the default admin view", () => {
    expect(resolveTransactionAccess(["ADMIN", "DONOR"], null)).toMatchObject({
      allowed: true,
      selfScoped: false,
      adminLedger: true,
    });
  });

  it("scopes an admin to self when using their Donor view", () => {
    expect(resolveTransactionAccess(["ADMIN", "DONOR"], "mine")).toMatchObject({
      allowed: true,
      selfScoped: true,
      adminLedger: false,
    });
  });

  it("does not let an admin without Donor role impersonate a Donor view", () => {
    expect(resolveTransactionAccess(["ADMIN"], "mine").allowed).toBe(false);
  });

  it("rejects accounts without a financial role", () => {
    expect(resolveTransactionAccess(["DEV"], null).allowed).toBe(false);
  });
});
