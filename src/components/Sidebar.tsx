"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { getRoleColor } from "@/lib/role-colors";

/* ------------------------------------------------------------------ */
/*  SVG Icon components                                                */
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

function IconTrophy(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 2h8v5a4 4 0 01-8 0V2z" />
      <path d="M5 4H3a1 1 0 00-1 1v1a3 3 0 003 3" />
      <path d="M13 4h2a1 1 0 011 1v1a3 3 0 01-3 3" />
      <path d="M9 11v2" />
      <path d="M6 15h6" />
      <path d="M7 13h4" />
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

function IconGantt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 4h8" />
      <path d="M4 9h10" />
      <path d="M3 14h6" />
      <circle cx="10" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconVps(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="2" width="12" height="5" rx="1.5" />
      <rect x="3" y="11" width="12" height="5" rx="1.5" />
      <circle cx="6" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="6" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
      <path d="M10 4.5h2" />
      <path d="M10 13.5h2" />
      <path d="M9 7v4" />
    </svg>
  );
}

function IconGitRepo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="5" r="2" />
      <circle cx="9" cy="13" r="2" />
      <path d="M9 7v4" />
      <path d="M13 5h-2" />
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

/* ------------------------------------------------------------------ */
/*  Types & nav data                                                   */
/* ------------------------------------------------------------------ */

type SvgIcon = (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;

interface NavItem {
  label: string;
  shortLabel: string;
  href: string;
  icon: string;
  Icon: SvgIcon;
}

const navByRole: Record<string, NavItem[]> = {
  ADMIN: [
    { label: "Dashboard",     shortLabel: "Home",    href: "/admin",                icon: "", Icon: IconDashboardGrid },
    { label: "Transactions",  shortLabel: "Txns",    href: "/admin/transactions",   icon: "", Icon: IconTransactions },
    { label: "Services",      shortLabel: "Svc",     href: "/admin/services",       icon: "", Icon: IconServer },
    { label: "Donors",        shortLabel: "Donors",  href: "/admin/donors",         icon: "", Icon: IconTrophy },
    { label: "Users",         shortLabel: "Users",   href: "/admin/users",          icon: "", Icon: IconUsers },
    { label: "Reminders",     shortLabel: "Remind",  href: "/admin/reminders",      icon: "", Icon: IconBell },
    { label: "Credentials",   shortLabel: "Creds",   href: "/admin/credentials",    icon: "", Icon: IconKey },
    { label: "VPS Stats",     shortLabel: "VPS",     href: "/admin/vps",            icon: "", Icon: IconVps },
    { label: "Repos",         shortLabel: "Repos",   href: "/admin/repos",          icon: "", Icon: IconGitRepo },
  ],
  DONOR: [
    { label: "My Donations", shortLabel: "Donate", href: "/donor", icon: "", Icon: IconChart },
  ],
  DEV: [
    { label: "Board",       shortLabel: "Board",  href: "/dev",              icon: "", Icon: IconKanban },
    { label: "My Tasks",    shortLabel: "Tasks",  href: "/dev/tasks",        icon: "", Icon: IconChecklist },
    { label: "Gantt",       shortLabel: "Gantt",  href: "/dev/gantt",        icon: "", Icon: IconGantt },
    { label: "VPS Stats",   shortLabel: "VPS",    href: "/dev/vps",          icon: "", Icon: IconVps },
    { label: "Credentials", shortLabel: "Creds",  href: "/dev/credentials",  icon: "", Icon: IconKey },
  ],
};

/* ------------------------------------------------------------------ */
/*  Sidebar component                                                  */
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
  const [moreOpen, setMoreOpen] = useState(false);
  const isSettings = pathname === "/profile" || pathname === "/admin/audit";
  const isAdmin = roles.includes("ADMIN");

  const primaryRole: Role = isAdmin ? "ADMIN" : roles.includes("DEV") ? "DEV" : "DONOR";

  const settingsNav: NavItem[] = [
    { label: "General",   shortLabel: "General", href: "/profile",      icon: "", Icon: IconDashboardGrid },
    ...(isAdmin ? [{ label: "Audit Log", shortLabel: "Audit", href: "/admin/audit", icon: "", Icon: IconAuditLog }] : []),
  ];

  const items = isSettings ? settingsNav : (navByRole[activeRole] || []);
  const sectionLabel = isSettings ? "Settings" : activeRole === "ADMIN" ? "Navigation" : activeRole === "DEV" ? "Navigation" : "Navigation";

  const roleLabels: Record<string, string> = {
    ADMIN: "Admin",
    DEV: "Dev",
    DONOR: "Donor",
  };

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <div
        className="hidden md:flex flex-shrink-0 sticky top-0 h-screen"
        style={{
          width: collapsed ? 72 : 252,
          transition: "width 250ms cubic-bezier(.4,0,.2,1)",
          padding: "10px 0 10px 10px",
        }}
      >
      <aside
        className="flex flex-col w-full h-full overflow-hidden"
        style={{
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          fontSize: 13,
        }}
      >
        {/* ── Header / brand ── */}
        <div
          style={{
            padding: !collapsed ? "16px 16px 12px" : "14px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: !collapsed ? "space-between" : "center",
            minHeight: 52,
            transition: "padding 200ms ease",
          }}
        >
          {!!collapsed ? (
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
                href={`/${primaryRole.toLowerCase()}`}
                data-tour="brand"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textDecoration: "none",
                  lineHeight: 1,
                }}
              >
                <img
                  src="/logo-icon.png"
                  alt="Sentinel"
                  style={{
                    width: 24,
                    height: 24,
                    objectFit: "contain",
                    borderRadius: 5,
                  }}
                />
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontWeight: 800,
                    fontSize: 14,
                    letterSpacing: "0.12em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {"Ｓ ☰ ＮＴＩＮ ☰ Ｌ"}
                </span>
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
                className="sidebar-collapse-btn"
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

        {/* ── Role tabs (like Claude's Chat / Cowork / Code) ── */}
        {!isSettings && roles.length > 1 && !collapsed && (
          <div data-tour="role-tabs" style={{ padding: "0 12px 8px" }}>
            <div
              style={{
                display: "flex",
                gap: 2,
                background: "var(--bg-deepest)",
                borderRadius: 12,
                padding: 4,
              }}
            >
              {roles.map((role) => {
                const isActive = role === activeRole;
                const rc = getRoleColor(role);
                return (
                  <button
                    key={role}
                    onClick={() => onRoleSwitch(role)}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      padding: "7px 0",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      color: isActive ? rc.text : "var(--text-tertiary)",
                      background: isActive ? rc.bg : "transparent",
                      boxShadow: isActive ? `0 0 8px rgba(${rc.rgb},0.15)` : "none",
                      transition: "all 150ms ease",
                      letterSpacing: "0.01em",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--text-tertiary)";
                      }
                    }}
                  >
                    {roleLabels[role] || role}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Collapsed role switcher ── */}
        {!isSettings && roles.length > 1 && !!collapsed && (
          <div style={{ padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
            {roles.map((role) => {
              const isActive = role === activeRole;
              const rc = getRoleColor(role);
              return (
                <button
                  key={role}
                  onClick={() => onRoleSwitch(role)}
                  title={`Switch to ${role}`}
                  style={{
                    width: 34,
                    height: 28,
                    borderRadius: 7,
                    border: "none",
                    background: isActive ? "var(--bg-card)" : "transparent",
                    color: isActive ? rc.text : "var(--text-tertiary)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 9,
                    fontWeight: isActive ? 600 : 400,
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-tertiary)";
                    }
                  }}
                >
                  {role === "ADMIN" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l3 7h7l-5.5 4.5 2 7L12 16l-6.5 4.5 2-7L2 9h7z" />
                    </svg>
                  ) : role === "DEV" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Divider ── */}
        <div style={{ height: 1, background: "var(--border)", margin: !collapsed ? "4px 16px" : "4px 8px", transition: "margin 200ms ease" }} />

        {/* ── Section label ── */}
        {!collapsed && (
          <div
            style={{
              padding: "14px 20px 6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--text-tertiary)",
                letterSpacing: "0.01em",
              }}
            >
              {sectionLabel}
            </span>
          </div>
        )}

        {/* ── Nav items ── */}
        <nav data-tour="nav" style={{ flex: 1, padding: !collapsed ? "2px 8px" : "6px 6px", transition: "padding 200ms ease", overflowY: "auto" }}>
          {items.map((item) => {
            const active = pathname === item.href;
            const { Icon } = item;

            if (!!collapsed) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "9px 0",
                    borderRadius: 8,
                    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                    transition: "all 150ms ease",
                    textDecoration: "none",
                    marginBottom: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-tertiary)";
                    }
                  }}
                >
                  <Icon style={{ width: 18, height: 18 }} />
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
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
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    opacity: active ? 0.85 : 0.4,
                    transition: "opacity 150ms",
                  }}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

      </aside>
      </div>

      {/* ── Mobile bottom bar ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "var(--bg-deep)",
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
                <span style={{ fontWeight: active ? 500 : 400 }}>{item.shortLabel}</span>
              </Link>
            );
          })}
          {items.length > 4 && (
            <button
              onClick={() => setMoreOpen(true)}
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
                color: moreOpen ? "var(--text-primary)" : "var(--text-tertiary)",
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

      {/* ── Mobile "More" sheet ── */}
      {items.length > 4 && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden"
            onClick={() => setMoreOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 55,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              opacity: moreOpen ? 1 : 0,
              pointerEvents: moreOpen ? "auto" : "none",
              transition: "opacity 250ms ease",
            }}
          />

          {/* Sheet */}
          <div
            className="md:hidden"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              zIndex: 60,
              bottom: moreOpen ? 56 : -400,
              transition: "bottom 300ms cubic-bezier(0.4,0,0.2,1)",
              background: "var(--bg-deep)",
              borderTop: "1px solid var(--border)",
              borderRadius: "18px 18px 0 0",
              paddingBottom: "max(16px, env(safe-area-inset-bottom))",
            }}
          >
            {/* Handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border-hover)" }} />
            </div>

            {/* Remaining nav items */}
            <div style={{ padding: "4px 12px 8px" }}>
              {items.slice(4).map((item) => {
                const active = pathname === item.href;
                const { Icon } = item;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "13px 16px",
                      borderRadius: 12,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      textDecoration: "none",
                      fontSize: 14,
                      fontWeight: active ? 500 : 400,
                      marginBottom: 2,
                    }}
                  >
                    <Icon style={{ width: 20, height: 20, flexShrink: 0, opacity: active ? 0.85 : 0.45 }} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
