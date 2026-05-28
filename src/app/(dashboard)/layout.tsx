"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import type { Role } from "@/generated/prisma/enums";

interface UserData {
  id: string;
  name: string;
  telegramUser: string;
  photoUrl: string | null;
  themeColor?: string;
  roles: Role[];
}

function applyThemeColor(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty("--lime", hex);
  document.documentElement.style.setProperty(
    "--lime-dim",
    `rgba(${r}, ${g}, ${b}, 0.08)`,
  );
  document.documentElement.style.setProperty(
    "--lime-glow",
    `rgba(${r}, ${g}, ${b}, 0.12)`,
  );
  document.documentElement.style.setProperty(
    "--border-active",
    `rgba(${r}, ${g}, ${b}, 0.3)`,
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserData | null>(null);
  const [activeRole, setActiveRole] = useState<Role>("ADMIN");

  // Fetch user data once on mount only
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        if (data.user.themeColor) {
          applyThemeColor(data.user.themeColor);
        }
      })
      .catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive activeRole from pathname whenever it changes — no re-fetch
  useEffect(() => {
    if (!user) return;
    const roleFromPath = pathname.startsWith("/admin")
      ? "ADMIN"
      : pathname.startsWith("/dev")
        ? "DEV"
        : "DONOR";
    if (user.roles.includes(roleFromPath as Role)) {
      setActiveRole(roleFromPath as Role);
    } else {
      setActiveRole(user.roles[0]);
    }
  }, [pathname, user]);

  function handleRoleSwitch(role: Role) {
    setActiveRole(role);
    const routes: Record<string, string> = {
      ADMIN: "/admin",
      DEV: "/dev",
      DONOR: "/donor",
    };
    router.push(routes[role]);
  }

  // Dynamic breadcrumb from pathname
  const breadcrumbMap: Record<string, string> = {
    "/admin": "Admin / Dashboard",
    "/admin/transactions": "Admin / Transactions",
    "/admin/services": "Admin / Services",
    "/admin/donors": "Admin / Donors",
    "/admin/users": "Admin / Users",
    "/admin/reminders": "Admin / Reminders",
    "/admin/credentials": "Admin / Credentials",
    "/admin/vps": "Admin / VPS Stats",
    "/admin/repos": "Admin / Repos",
    "/admin/audit": "Settings / Audit Log",
    "/dev": "Dev / Board",
    "/dev/tasks": "Dev / My Tasks",
    "/dev/gantt": "Dev / Gantt",
    "/dev/vps": "Dev / VPS Stats",
    "/dev/credentials": "Dev / Credentials",
    "/donor": "Donor / Overview",
    "/donor/receipts": "Donor / Receipts",
    "/profile": "Settings / General",
  };
  const breadcrumb = breadcrumbMap[pathname] || pathname.split("/").filter(Boolean).join(" / ");

  if (!user) {
    return (
      <div className="flex min-h-screen">
        {/* Sidebar skeleton */}
        <div className="skeleton w-[200px] min-h-screen shrink-0" />
        {/* Content area skeleton */}
        <div className="flex-1 flex flex-col gap-0">
          {/* Header bar skeleton */}
          <div className="skeleton h-14 w-full rounded-none" />
          {/* Card skeletons */}
          <div className="flex-1 p-6 md:p-8 flex flex-col gap-4">
            <div className="skeleton h-32 w-full" />
            <div className="skeleton h-32 w-full" />
            <div className="skeleton h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        roles={user.roles}
        activeRole={activeRole}
        onRoleSwitch={handleRoleSwitch}
      />
      <div className="flex-1 flex flex-col overflow-x-hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 px-6 md:px-8 py-3 border-b border-[var(--border)]" style={{ background: "rgba(17,17,22,0.6)", backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)" }}>
          <div className="flex items-center gap-1.5">
            {breadcrumb.split(" / ").map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-text-tertiary opacity-40">
                    <path d="M3.5 2l3.5 3-3.5 3" />
                  </svg>
                )}
                <span
                  className="font-mono text-[11px] uppercase tracking-widest"
                  style={{
                    color: i === arr.length - 1 ? "var(--text-secondary)" : "var(--text-tertiary)",
                    fontWeight: i === arr.length - 1 ? 500 : 400,
                  }}
                >
                  {seg}
                </span>
              </span>
            ))}
          </div>
          <TopBar
            name={user.name}
            photoUrl={user.photoUrl}
            telegramUser={user.telegramUser}
            roles={user.roles}
          />
        </header>
        <main className="flex-1 p-6 md:p-8 pb-24 md:pb-8">
          <div key={pathname} className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
      <div className="grain" />
    </div>
  );
}
