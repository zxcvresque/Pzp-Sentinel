import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, isEncrypted } from "./secret-crypto";

beforeAll(() => {
  // Stable 32-byte key for the test run.
  process.env.CREDENTIAL_ENC_KEY = randomBytes(32).toString("base64");
});

describe("secret-crypto", () => {
  it("round-trips a secret", () => {
    const plain = "super-secret-root-password-🔐";
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("keeps empty strings empty (the 'no secret' sentinel)", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(isEncrypted("")).toBe(false);
  });

  it("passes legacy plaintext through decrypt unchanged", () => {
    expect(decryptSecret("legacy-plaintext-value")).toBe("legacy-plaintext-value");
    expect(isEncrypted("legacy-plaintext-value")).toBe(false);
  });

  it("does not double-wrap an already-encrypted value", () => {
    const once = encryptSecret("abc");
    const twice = encryptSecret(once);
    expect(twice).toBe(once);
    expect(decryptSecret(twice)).toBe("abc");
  });

  it("uses a fresh IV each time but decrypts to the same plaintext", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b); // different IV -> different ciphertext
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("fails to decrypt a tampered ciphertext (GCM auth)", () => {
    const enc = encryptSecret("integrity-protected");
    // Flip a character in the ciphertext segment.
    const parts = enc.split(":");
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -2) + (parts[parts.length - 1].slice(-2) === "AA" ? "BB" : "AA");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
