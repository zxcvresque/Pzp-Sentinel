import crypto from "node:crypto";

// Field-level encryption for secrets at rest (AES-256-GCM).
// Stored format: `enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>`.
// - encrypt fails closed if CREDENTIAL_ENC_KEY is missing/invalid.
// - decrypt passes legacy plaintext (no `enc:v1:` prefix) through unchanged,
//   so the rollout can happen before all rows are migrated.
// Public keys are NOT secrets and must not be passed through here.

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENC_KEY is not set — refusing to handle secrets. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENC_KEY must decode to exactly 32 bytes (base64).");
  }
  cachedKey = key;
  return key;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt a secret. Empty string stays empty (sentinel for "no secret"). */
export function encryptSecret(plain: string | null | undefined): string {
  if (plain == null || plain === "") return "";
  if (isEncrypted(plain)) return plain; // already encrypted — don't double-wrap
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a stored secret. Legacy plaintext (no prefix) is returned as-is. */
export function decryptSecret(stored: string | null | undefined): string {
  if (stored == null || stored === "") return "";
  if (!isEncrypted(stored)) return stored;
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
