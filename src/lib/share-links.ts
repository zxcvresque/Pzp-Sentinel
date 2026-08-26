import { randomBytes } from "node:crypto";

export const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;
export const SHARE_ENTITY_TYPES = ["audit", "transaction", "service", "credential", "openrouter-account", "openrouter-key"] as const;
export type ShareEntityType = typeof SHARE_ENTITY_TYPES[number];

export function isShareEntityType(value: unknown): value is ShareEntityType {
  return typeof value === "string" && SHARE_ENTITY_TYPES.includes(value as ShareEntityType);
}

export function createShareCode() {
  return randomBytes(6).toString("base64url");
}

export function shareTargetPath(entityType: ShareEntityType, entityId: string) {
  const shared = encodeURIComponent(`${entityType}:${entityId}`);
  const id = encodeURIComponent(entityId);
  const hash = `#shared-${id}`;
  switch (entityType) {
    case "audit": return `/admin/audit?shared=${shared}&auditId=${id}${hash}`;
    case "transaction": return `/admin/transactions?shared=${shared}&transactionId=${id}${hash}`;
    case "service": return `/admin/services/${id}?shared=${shared}${hash}`;
    case "credential": return `/admin/credentials?shared=${shared}${hash}`;
    case "openrouter-account": return `/admin/openrouter?shared=${shared}${hash}`;
    case "openrouter-key": return `/admin/openrouter?shared=${shared}&keyId=${id}${hash}`;
  }
}

export function shareBaseUrl(fallbackOrigin: string) {
  return (process.env.SHARE_BASE_URL || fallbackOrigin).replace(/\/$/, "");
}

export function shareStartCode(payload: string | undefined) {
  if (!payload?.startsWith("share_")) return null;
  const code = payload.slice(6);
  return SHARE_CODE_PATTERN.test(code) ? code : "";
}
