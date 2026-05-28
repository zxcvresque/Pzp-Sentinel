"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Hook that manages page-specific mini tours.
 * On first visit to a page (per user), triggers a short 2-3 step tour.
 * Tracks completion via localStorage: `sentinel_page_tour_{userId}_{pageKey}`
 */
export function usePageTour(userId: string | undefined, pageKey: string) {
  const [active, setActive] = useState(false);

  const storageKey = userId ? `sentinel_page_tour_${userId}_${pageKey}` : "";

  useEffect(() => {
    if (!userId || !pageKey) return;
    if (localStorage.getItem(storageKey)) return;

    // Don't trigger if the main tour hasn't been seen yet (let that run first)
    const mainTourKey = `sentinel_tour_seen_${userId}`;
    if (!localStorage.getItem(mainTourKey)) return;

    // Small delay so page content renders and data-tour elements are in the DOM
    const timer = setTimeout(() => setActive(true), 600);
    return () => clearTimeout(timer);
  }, [userId, pageKey, storageKey]);

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
