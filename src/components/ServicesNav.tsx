"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const linksByRole = {
  ADMIN: [
    { label: "Catalogue", href: "/admin/services" },
    { label: "Credentials", href: "/admin/credentials" },
    { label: "VPS Stats", href: "/admin/vps" },
    { label: "API Usage", href: "/admin/api-usage" },
  ],
  DEV: [
    { label: "VPS Stats", href: "/dev/vps" },
    { label: "Credentials", href: "/dev/credentials" },
  ],
} as const;

export default function ServicesNav({ role }: { role: keyof typeof linksByRole }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Services"
      className="mb-6 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] p-1.5"
    >
      {linksByRole[role].map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className="min-w-max rounded-lg px-4 py-2 text-sm transition-all duration-150"
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
