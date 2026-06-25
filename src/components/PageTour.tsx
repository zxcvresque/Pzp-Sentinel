"use client";

import { useEffect, useState } from "react";
import SpotlightTour from "@/components/SpotlightTour";
import { getPageTourSteps } from "@/lib/tour-steps";
import { usePageTour } from "@/hooks/usePageTour";

interface PageTourProps {
  /** Unique key for this page, e.g. "admin-dashboard", "dev-board" */
  pageKey: string;
  /** Bump (>1) when the tour gains steps so it re-shows once for prior viewers. */
  version?: number;
}

/**
 * Drop-in component for page-specific mini tours.
 * Fetches the current user ID from /api/auth/me and triggers a
 * 2-3 step tour on first visit to this page.
 */
export default function PageTour({ pageKey, version = 1 }: PageTourProps) {
  const [userId, setUserId] = useState<string | undefined>();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user?.id) setUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  const steps = getPageTourSteps(pageKey);
  const { active, finish } = usePageTour(userId, pageKey, version);

  if (steps.length === 0) return null;

  return <SpotlightTour steps={steps} active={active} onFinish={finish} />;
}
