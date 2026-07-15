import { createHash } from "node:crypto";

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/;

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
