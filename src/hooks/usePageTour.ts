"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Hook that manages page-specific mini tours.
 * On first visit to a page (per user), triggers a short 2-3 step tour.
 * Tracks completion via localStorage: `sentinel_page_tour_{userId}_{pageKey}`.
 * Bump `version` (>1) when a tour gains new steps so it re-shows once for users
 * who already completed the older version (suffixes the key with `_v{version}`).
 */
export function usePageTour(userId: string | undefined, pageKey: string, version = 1) {
  const [active, setActive] = useState(false);
  const [gateVersion, setGateVersion] = useState(0);

  const versionSuffix = version > 1 ? `_v${version}` : "";
  const storageKey = userId ? `sentinel_page_tour_${userId}_${pageKey}${versionSuffix}` : "";
  const role = pageKey.startsWith("admin-") ? "ADMIN" : pageKey.startsWith("dev-") ? "DEV" : "DONOR";

  useEffect(() => {
    const refreshGate = () => setGateVersion((current) => current + 1);
    window.addEventListener("sentinel-tour-gate-change", refreshGate);
    return () => window.removeEventListener("sentinel-tour-gate-change", refreshGate);
  }, []);

  useEffect(() => {
    if (!userId || !pageKey) return;
    if (localStorage.getItem(storageKey)) return;

    // Welcome, workspace and page tours are mutually exclusive. Page tours only
    // begin after the active role's workspace tour has completed.
    const mainTourKey = `sentinel_tour_seen_${userId}_${role}`;
    if (document.documentElement.dataset.onboardingActive === "1") return;
    if (document.documentElement.dataset.mainTourActive === "1") return;
    if (localStorage.getItem(`sentinel_page_tours_disabled_${userId}_${role}`)) return;
    if (!localStorage.getItem(mainTourKey)) return;

    // Small delay so page content renders and data-tour elements are in the DOM
    const timer = setTimeout(() => setActive(true), 600);
    return () => clearTimeout(timer);
  }, [userId, pageKey, role, storageKey, gateVersion]);

  const finish = useCallback(() => {
    setActive(false);
    if (storageKey) {
      localStorage.setItem(storageKey, "1");
    }
  }, [storageKey]);

  const reset = useCallback(() => {
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  return { active, finish, reset };
}
