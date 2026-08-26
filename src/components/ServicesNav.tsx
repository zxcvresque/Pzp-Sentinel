"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import OpenRouterLogo from "@/components/OpenRouterLogo";

const linksByRole = {
  ADMIN: [
    { label: "Catalogue", shortLabel: "Catalogue", href: "/admin/services", icon: "catalogue" },
    { label: "OpenRouter", shortLabel: "OpenRouter", href: "/admin/openrouter", icon: "openrouter" },
    { label: "VPS", shortLabel: "VPS", href: "/admin/vps", icon: "vps" },
    { label: "Credentials", shortLabel: "Credentials", href: "/admin/credentials", icon: "credentials" },
    { label: "Operational alerts", shortLabel: "Alerts", href: "/admin/alerts", icon: "alerts" },
  ],
  DEV: [
    { label: "VPS Stats", shortLabel: "VPS", href: "/dev/vps", icon: "vps" },
    { label: "OpenRouter", shortLabel: "OpenRouter", href: "/dev/openrouter", icon: "openrouter" },
    { label: "Credentials", shortLabel: "Credentials", href: "/dev/credentials", icon: "credentials" },
  ],
} as const;

function ServiceIcon({ icon }: { icon: "catalogue" | "openrouter" | "vps" | "credentials" | "alerts" }) {
  if (icon === "openrouter") return <OpenRouterLogo variant="mark" width={18} className="h-4 w-4 rounded-[4px]" />;
  const paths = {
    catalogue: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    vps: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
    credentials: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  } as const;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[icon]}</svg>;
}

export default function ServicesNav({ role }: { role: keyof typeof linksByRole }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Services"
      className="mb-6 flex max-w-full snap-x snap-mandatory gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {linksByRole[role].map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className="inline-flex shrink-0 snap-center items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-xs transition-all duration-150 sm:flex-1 sm:px-4 sm:text-sm"
            style={{
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
              background: active ? "rgba(255,255,255,0.07)" : "transparent",
              boxShadow: active ? "inset 0 0 0 1px var(--border)" : "none",
              fontWeight: active ? 600 : 400,
            }}
          >
            <ServiceIcon icon={link.icon} />
            <span className="sm:hidden">{link.shortLabel}</span>
            <span className="hidden sm:inline">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
