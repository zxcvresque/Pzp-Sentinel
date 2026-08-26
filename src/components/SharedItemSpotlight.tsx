"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function SharedItemSpotlight() {
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("shared");
    if (!shared) return;
    let cancelled = false;
    let attempts = 0;
    const [type] = shared.split(":", 1);
    const locate = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>(`[data-share-target="${CSS.escape(shared)}"]`);
      if (!target && attempts++ < 40) {
        window.setTimeout(locate, 150);
        return;
      }
      if (!target) {
        setMessage("This shared item is not in the current filtered view.");
        return;
      }
      target.classList.add("sentinel-shared-spotlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setMessage(`${type.replace(/-/g, " ")} handoff located`);
      const cleanup = window.setTimeout(() => target.classList.add("sentinel-shared-spotlight-settled"), 4200);
      return () => window.clearTimeout(cleanup);
    };
    const timer = window.setTimeout(locate, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pathname]);

  if (!message) return null;
  return (
    <div className="sentinel-shared-toast" role="status">
      <span className="sentinel-shared-orbit" aria-hidden="true"><i /><i /><i /></span>
      <span><b>Shared in Sentinel</b><small>{message}</small></span>
      <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
