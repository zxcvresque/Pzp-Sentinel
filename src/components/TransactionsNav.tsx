"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const links = [
  { label: "Ledger", href: "/admin/transactions", key: "ledger" },
  { label: "Pending approvals", href: "/admin/transactions?status=PENDING", key: "pending" },
  { label: "Reconciliation", href: "/admin/reconciliation", key: "reconciliation" },
  { label: "Record transaction", href: "/admin/transactions/new", key: "record" },
] as const;

export default function TransactionsNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = pathname === "/admin/reconciliation"
    ? "reconciliation"
    : pathname === "/admin/transactions/new"
      ? "record"
      : params.get("status") === "PENDING" ? "pending" : "ledger";

  return (
    <nav aria-label="Transactions" className="mb-6 grid grid-cols-2 gap-1.5 rounded-2xl border border-[var(--border)] bg-bg-deep p-1.5 sm:flex">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={current === link.key ? "page" : undefined}
          className={`min-w-0 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition sm:px-4 sm:text-sm ${current === link.key ? "bg-lime/10 text-lime ring-1 ring-lime/20" : "text-text-tertiary hover:bg-white/[.04] hover:text-text-secondary"}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
