"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps on-screen data current without a manual reload by re-running `refresh`:
 *   - when the tab regains focus / visibility (instant on return), and
 *   - on a fixed interval while the tab is visible.
 *
 * The caller still does its OWN initial fetch (e.g. on mount). This hook only
 * fires the *background* re-fetches, so `refresh` must NOT toggle a loading /
 * skeleton state — otherwise the page would flash a spinner every interval.
 * Refreshes are skipped while the tab is hidden to avoid needless API load.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<unknown>,
  intervalMs = 30_000,
) {
  // Keep the latest callback in a ref so we don't re-subscribe (and reset the
  // interval) every render when `refresh` is a new closure.
  const saved = useRef(refresh);
  saved.current = refresh;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible") return;
      // Swallow errors from a background refresh — a failed poll should keep the
      // last good data on screen, never throw an unhandled rejection.
      try {
        Promise.resolve(saved.current()).catch(() => {});
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    const id = setInterval(run, intervalMs);

    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      clearInterval(id);
    };
  }, [intervalMs]);
}
