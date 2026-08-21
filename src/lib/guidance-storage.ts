export const GUIDANCE_VERSION = 2;

export type GuidanceRole = "ADMIN" | "DEV" | "DONOR";

export function isGuidanceRole(value: string | null): value is GuidanceRole {
  return value === "ADMIN" || value === "DEV" || value === "DONOR";
}

const guidancePrefix = `sentinel_guidance_v${GUIDANCE_VERSION}`;

export function introStorageKey(userId: string, role: GuidanceRole) {
  return `${guidancePrefix}_intro_seen_${userId}_${role}`;
}

export function mainTourStorageKey(userId: string, role: GuidanceRole) {
  return `${guidancePrefix}_tour_seen_${userId}_${role}`;
}

export function pageToursDisabledStorageKey(userId: string, role: GuidanceRole) {
  return `${guidancePrefix}_page_tours_disabled_${userId}_${role}`;
}

export function pageTourStoragePrefix(userId: string) {
  return `${guidancePrefix}_page_tour_${userId}_`;
}

export function pageTourStorageKey(userId: string, pageKey: string, version = 1) {
  const versionSuffix = version > 1 ? `_v${version}` : "";
  return `${pageTourStoragePrefix(userId)}${pageKey}${versionSuffix}`;
}
