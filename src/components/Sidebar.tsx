"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const navByRole: Record<string, NavItem[]> = {
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: "◈" },
    { label: "Transactions", href: "/admin/transactions", icon: "₹" },
    { label: "Services", href: "/admin/services", icon: "◎" },
    { label: "Subscriptions", href: "/admin/subscriptions", icon: "◇" },
    { label: "Users", href: "/admin/users", icon: "◉" },
    { label: "Reminders", href: "/admin/reminders", icon: "◆" },
    { label: "Credentials", href: "/admin/credentials", icon: "◍" },
    { label: "Audit Log", href: "/admin/audit", icon: "◌" },
  ],
  DONOR: [
    { label: "Dashboard", href: "/donor", icon: "◈" },
    { label: "Receipts", href: "/donor/receipts", icon: "◇" },
  ],
  DEV: [
    { label: "Board", href: "/dev", icon: "◈" },
    { label: "My Tasks", href: "/dev/tasks", icon: "◎" },
    { label: "Credentials", href: "/dev/credentials", icon: "◍" },
  ],
};

export default function Sidebar({
  roles,
  activeRole,
  onRoleSwitch,
}: {
  roles: Role[];
  activeRole: Role;
  onRoleSwitch: (role: Role) => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items = navByRole[activeRole] || [];

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col flex-shrink-0 bg-bg-deepest border-r border-[var(--border)] sticky top-0 h-screen overflow-y-auto transition-[width] duration-200 ${
          collapsed ? "w-[56px]" : "w-[220px]"
        }`}
      >
        <div className={`flex items-center border-b border-[var(--border)] ${collapsed ? "justify-center p-3" : "justify-between p-5"}`}>
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="text-lime font-extrabold text-lg"
              title="Expand sidebar"
            >
              S
            </button>
          ) : (
            <>
              <Link href="/" className="text-lg text-lime font-extrabold whitespace-nowrap" style={{ letterSpacing: "0.05em" }}>
                {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                className="text-text-tertiary hover:text-text-primary transition-colors text-xs ml-2"
                title="Collapse sidebar"
              >
                ◂
              </button>
            </>
          )}
        </div>

        <nav className={`flex-1 py-3 ${collapsed ? "px-1" : "px-3"}`}>
          {!collapsed && (
            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-tertiary px-2 pb-2">
              {activeRole}
            </div>
          )}
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center ${collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"} rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-[var(--lime-dim)] text-lime"
                    : "text-text-secondary hover:bg-[rgba(255,255,255,0.03)] hover:text-text-primary"
                }`}
              >
                <span className={`opacity-60 ${collapsed ? "text-base" : "text-xs"}`}>{item.icon}</span>
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {!collapsed && roles.length > 1 && (
          <div className="p-3 border-t border-[var(--border)]">
            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-tertiary px-2 pb-2">
              Switch Role
            </div>
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => onRoleSwitch(role)}
                className={`block w-full text-center font-mono text-[11px] uppercase tracking-[0.08em] py-2 rounded-lg border mb-1 transition-colors ${
                  role === activeRole
                    ? "bg-lime text-bg-void border-lime"
                    : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        )}

        {collapsed && roles.length > 1 && (
          <div className="py-2 px-1 border-t border-[var(--border)]">
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => onRoleSwitch(role)}
                title={`Switch to ${role}`}
                className={`block w-full text-center font-mono text-[9px] uppercase py-1.5 rounded-lg border mb-1 transition-colors ${
                  role === activeRole
                    ? "bg-lime text-bg-void border-lime"
                    : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
                }`}
              >
                {role.charAt(0)}
              </button>
            ))}
          </div>
        )}

      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-[var(--border)] pb-[max(6px,env(safe-area-inset-bottom))]">
        <div className="flex justify-around py-2">
          {items.slice(0, 4).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.05em] ${
                  active ? "text-lime" : "text-text-tertiary"
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                <span>{item.label.substring(0, 6)}</span>
                {active && (
                  <span className="w-1 h-1 rounded-full bg-lime" />
                )}
              </Link>
            );
          })}
          {items.length > 4 && (
            <button className="flex flex-col items-center gap-0.5 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.05em] text-text-tertiary">
              <span className="text-sm">⋯</span>
              <span>More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
