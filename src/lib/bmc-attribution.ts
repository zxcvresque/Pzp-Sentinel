import { createHash, randomBytes } from "node:crypto";

const CODE_PREFIX = "PZP-BMC";
const CODE_PATTERN = /\bPZP-BMC-[A-F0-9]{4}(?:-[A-F0-9]{4}){4}\b/i;

export const BMC_INTENT_TTL_MINUTES = 60;

export function bmcAccountSlug() {
  return process.env.BMC_ACCOUNT_SLUG?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "current";
}

export function generateBmcAttributionCode() {
  const raw = randomBytes(10).toString("hex").toUpperCase();
  return `${CODE_PREFIX}-${raw.match(/.{1,4}/g)!.join("-")}`;
}

export function normalizeBmcAttributionCode(code: string) {
  return code.trim().toUpperCase();
}

export function hashBmcAttributionCode(code: string) {
  return createHash("sha256").update(normalizeBmcAttributionCode(code)).digest("hex");
}

export function extractBmcAttributionCode(note: string | null | undefined) {
  const match = note?.match(CODE_PATTERN)?.[0];
  return match ? normalizeBmcAttributionCode(match) : null;
}
