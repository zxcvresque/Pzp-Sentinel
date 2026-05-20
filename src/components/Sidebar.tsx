"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";

/* ------------------------------------------------------------------ */
/*  SVG Icon components (inline, no library)                          */
/* ------------------------------------------------------------------ */

function IconDashboardGrid(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="10.5" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="2" y="10.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="10.5" y="10.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function IconTransactions(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13 3v12M13 3l-3 3M13 3l3 3" />
      <path d="M5 15V3M5 15l-3-3M5 15l3-3" />
    </svg>
  );
}

function IconServer(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="14" height="5" rx="1.5" />
      <rect x="2" y="11" width="14" height="5" rx="1.5" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCreditCard(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="1.5" y="3.5" width="15" height="11" rx="2" />
      <path d="M1.5 7.5h15" />
      <path d="M5 11.5h3" />
    </svg>
  );
}

function IconUsers(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6.5" cy="5.5" r="2.5" />
      <path d="M1.5 15c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
      <circle cx="13" cy="6" r="2" />
      <path d="M13.5 10.5c1.8.3 3 1.8 3 3.5" />
    </svg>
  );
}

function IconBell(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13.5 6.5a4.5 4.5 0 10-9 0c0 5-2 6.5-2 6.5h13s-2-1.5-2-6.5" />
      <path d="M7.5 13a1.5 1.5 0 003 0" />
    </svg>
  );
}

function IconKey(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="11" r="3.5" />
      <path d="M8.5 8.5L14 3" />
      <path d="M12 3l2 2" />
      <path d="M10.5 6.5l1.5 1.5" />
    </svg>
  );
}

function IconAuditLog(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 2.5h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2z" />
      <path d="M6 6.5h6" />
      <path d="M6 9.5h6" />
      <path d="M6 12.5h3" />
    </svg>
  );
}

function IconChart(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 15.5h14" />
      <path d="M3.5 12.5l3.5-4 3 2.5 4.5-5.5" />
    </svg>
  );
}

function IconDocument(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 2h6l4 4v9.5a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 014 15.5v-12A1.5 1.5 0 015 2z" />
      <path d="M11 2v4h4" />
      <path d="M7 10h4" />
      <path d="M7 13h2.5" />
    </svg>
  );
}

function IconKanban(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="4" height="14" rx="1" />
      <rect x="7" y="2" width="4" height="9" rx="1" />
      <rect x="12" y="2" width="4" height="11" rx="1" />
    </svg>
  );
}

function IconChecklist(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 5l1.5 1.5L7.5 3" />
      <path d="M9.5 5h5.5" />
      <path d="M3 10l1.5 1.5L7.5 8" />
      <path d="M9.5 10h5.5" />
      <path d="M3 15l1.5 1.5L7.5 13" />
      <path d="M9.5 15h5.5" />
    </svg>
  );
}

function IconMore(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCollapse(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3L5 7l4 4" />
    </svg>
  );
}

function IconExpand(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 3l4 4-4 4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Icon component type & nav item                                    */
/* ------------------------------------------------------------------ */

type SvgIcon = (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;

interface NavItem {
  label: string;
  href: string;
  icon: string;          // kept for interface compat
  Icon: SvgIcon;
}

const navByRole: Record<string, NavItem[]> = {
  ADMIN: [
    { label: "Dashboard",     href: "/admin",                icon: "◈", Icon: IconDashboardGrid },
    { label: "Transactions",  href: "/admin/transactions",   icon: "₹", Icon: IconTransactions },
    { label: "Services",      href: "/admin/services",       icon: "◎", Icon: IconServer },
    { label: "Subscriptions", href: "/admin/subscriptions",  icon: "◇", Icon: IconCreditCard },
    { label: "Users",         href: "/admin/users",          icon: "◉", Icon: IconUsers },
    { label: "Reminders",     href: "/admin/reminders",      icon: "◆", Icon: IconBell },
    { label: "Credentials",   href: "/admin/credentials",    icon: "◍", Icon: IconKey },
    { label: "Audit Log",     href: "/admin/audit",          icon: "◌", Icon: IconAuditLog },
  ],
  DONOR: [
    { label: "Dashboard", href: "/donor",          icon: "◈", Icon: IconChart },
    { label: "Receipts",  href: "/donor/receipts",  icon: "◇", Icon: IconDocument },
  ],
  DEV: [
    { label: "Board",       href: "/dev",              icon: "◈", Icon: IconKanban },
    { label: "My Tasks",    href: "/dev/tasks",        icon: "◎", Icon: IconChecklist },
    { label: "Credentials", href: "/dev/credentials",  icon: "◍", Icon: IconKey },
  ],
};

/* ------------------------------------------------------------------ */
/*  Sidebar component                                                 */
/* ------------------------------------------------------------------ */

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
      {/* ── Desktop sidebar ── */}
      <aside
        style={{
          background: "rgba(17,17,22,0.55)",
          backdropFilter: "blur(40px) saturate(1.6)",
          WebkitBackdropFilter: "blur(40px) saturate(1.6)",
          borderRight: "1px solid var(--border)",
          width: collapsed ? 60 : 232,
          transition: "width 200ms cubic-bezier(.4,0,.2,1)",
          fontSize: 13,
        }}
        className="hidden md:flex flex-col flex-shrink-0 sticky top-0 h-screen overflow-y-auto"
      >
        {/* ── Header / brand ── */}
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            padding: collapsed ? "14px 8px" : "18px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            minHeight: 56,
          }}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                lineHeight: 1,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src="/logo-icon.png"
                alt="Sentinel"
                style={{
                  width: 28,
                  height: 28,
                  objectFit: "contain",
                  borderRadius: 6,
                }}
              />
            </button>
          ) : (
            <>
              <Link
                href={`/${activeRole.toLowerCase()}`}
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 800,
                  fontSize: 16,
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  lineHeight: 1,
                }}
              >
                {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
                style={{
                  color: "var(--text-tertiary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  transition: "color 150ms, background 150ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-tertiary)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <IconCollapse />
              </button>
            </>
          )}
        </div>

        {/* ── Nav items ── */}
        <nav style={{ flex: 1, padding: collapsed ? "10px 6px" : "10px 10px" }}>
          {!collapsed && (
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: "var(--text-tertiary)",
                padding: "0 10px 8px",
              }}
            >
              {activeRole}
            </div>
          )}

          {items.map((item, idx) => {
            const active = pathname === item.href;
            const { Icon } = item;

            return (
              <div key={item.href}>
                {/* Separator between sections (after 4th item in admin, etc.) */}
                {!collapsed && idx > 0 && idx % 4 === 0 && (
                  <div
                    style={{
                      height: 1,
                      background: "var(--border)",
                      margin: "6px 10px 6px",
                      opacity: 0.6,
                    }}
                  />
                )}

                {collapsed ? (
                  /* ── Collapsed nav item ── */
                  <Link
                    href={item.href}
                    title={item.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 0",
                      borderRadius: 8,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      transition: "all 150ms ease",
                      textDecoration: "none",
                      marginBottom: 2,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                        e.currentTarget.style.color = "var(--text-primary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                  >
                    <Icon style={{ width: 20, height: 20 }} />
                  </Link>
                ) : (
                  /* ── Expanded nav item ── */
                  <Link
                    href={item.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 12px",
                      borderRadius: 8,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      textDecoration: "none",
                      transition: "all 150ms ease",
                      marginBottom: 1,
                      fontSize: 13,
                      fontWeight: active ? 500 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                        e.currentTarget.style.color = "var(--text-primary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                  >
                    <Icon
                      style={{
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        opacity: active ? 0.9 : 0.45,
                        transition: "opacity 150ms",
                      }}
                    />
                    <span>{item.label}</span>
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        {/* ── Role switcher (expanded) ── */}
        {!collapsed && roles.length > 1 && (
          <div
            style={{
              padding: "12px 12px 14px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: "var(--text-tertiary)",
                padding: "0 6px 8px",
              }}
            >
              Switch Role
            </div>
            <div style={{ display: "flex", gap: 6, padding: "0 4px" }}>
              {roles.map((role) => {
                const isActive = role === activeRole;
                return (
                  <button
                    key={role}
                    onClick={() => onRoleSwitch(role)}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      padding: "6px 0",
                      borderRadius: 20,
                      border: isActive ? "1px solid rgba(99,102,241,0.25)" : "1px solid var(--border)",
                      background: isActive ? "rgba(99,102,241,0.10)" : "transparent",
                      color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontWeight: isActive ? 600 : 400,
                      transition: "all 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "var(--border-hover)";
                        e.currentTarget.style.color = "var(--text-primary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Role switcher (collapsed) ── */}
        {collapsed && roles.length > 1 && (
          <div
            style={{
              padding: "8px 6px 10px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
            }}
          >
            {roles.map((role) => {
              const isActive = role === activeRole;
              return (
                <button
                  key={role}
                  onClick={() => onRoleSwitch(role)}
                  title={`Switch to ${role}`}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: isActive ? "1.5px solid rgba(99,102,241,0.25)" : "1.5px solid var(--border)",
                    background: isActive ? "rgba(99,102,241,0.10)" : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    fontWeight: isActive ? 600 : 400,
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "var(--border-hover)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  {role.charAt(0)}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Mobile bottom bar ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass"
        style={{
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(6px, env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-around", padding: "6px 0" }}>
          {items.slice(0, 4).map((item) => {
            const active = pathname === item.href;
            const { Icon } = item;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  padding: "4px 12px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                  textDecoration: "none",
                  transition: "color 150ms",
                }}
              >
                <Icon style={{ width: 20, height: 20 }} />
                <span style={{ fontWeight: active ? 500 : 400 }}>{item.label.substring(0, 6)}</span>
              </Link>
            );
          })}
          {items.length > 4 && (
            <button
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "4px 12px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-tertiary)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              <IconMore style={{ width: 20, height: 20 }} />
              <span>More</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
