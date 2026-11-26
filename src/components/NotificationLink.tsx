"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export default function NotificationLink({ id, href, children, className }: { id: string; href: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={className} onClick={() => {
    void fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }), keepalive: true });
  }}>{children}</Link>;
}
