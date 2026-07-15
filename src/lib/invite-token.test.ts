import { describe, expect, it } from "vitest";
import { hashInviteToken, INVITE_TOKEN_PATTERN } from "./invite-token";

describe("one-time invitation tokens", () => {
  it("accepts the base64url token shape used in Telegram deep links", () => {
    expect(INVITE_TOKEN_PATTERN.test("a".repeat(43))).toBe(true);
    expect(INVITE_TOKEN_PATTERN.test("too-short")).toBe(false);
    expect(INVITE_TOKEN_PATTERN.test("!".repeat(43))).toBe(false);
  });

  it("hashes tokens deterministically without storing the secret", () => {
    const token = "a".repeat(43);
    const hash = hashInviteToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });
});
