"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const linksByRole = {
  ADMIN: [
    { label: "Catalogue", href: "/admin/services" },
    { label: "OpenRouter", href: "/admin/openrouter" },
    { label: "VPS", href: "/admin/vps" },
    { label: "Credentials", href: "/admin/credentials" },
    { label: "Operational alerts", href: "/admin/alerts" },
  ],
  DEV: [
    { label: "VPS Stats", href: "/dev/vps" },
    { label: "OpenRouter", href: "/dev/openrouter" },
    { label: "Credentials", href: "/dev/credentials" },
  ],
} as const;

export default function ServicesNav({ role }: { role: keyof typeof linksByRole }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Services"
      className="mb-6 grid max-w-full grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-1.5 sm:flex"
    >
      {linksByRole[role].map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className="min-w-0 rounded-lg px-3 py-2 text-center text-xs transition-all duration-150 sm:px-4 sm:text-sm"
            style={{
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
              background: active ? "rgba(255,255,255,0.07)" : "transparent",
              boxShadow: active ? "inset 0 0 0 1px var(--border)" : "none",
              fontWeight: active ? 600 : 400,
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
