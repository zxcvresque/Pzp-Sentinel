"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sentinel:hideFormExamples";

/**
 * Hook for form example hints.
 *
 * Returns:
 *  - showExamples: whether to render example content
 *  - hideExamples: call to permanently hide (stored in localStorage)
 *  - enableExamples: call to re-enable (used from profile settings)
 */
export function useFormExamples() {
  const [showExamples, setShowExamples] = useState(false);

  useEffect(() => {
    const hidden = localStorage.getItem(STORAGE_KEY);
    setShowExamples(hidden !== "true");
  }, []);

  const hideExamples = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShowExamples(false);
  }, []);

  const enableExamples = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setShowExamples(true);
  }, []);

  return { showExamples, hideExamples, enableExamples };
}
