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
  roles: Role[];
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

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        const roleFromPath = pathname.startsWith("/admin")
          ? "ADMIN"
          : pathname.startsWith("/dev")
            ? "DEV"
            : "DONOR";
        if (data.user.roles.includes(roleFromPath)) {
          setActiveRole(roleFromPath as Role);
        } else {
          setActiveRole(data.user.roles[0]);
        }
      })
      .catch(() => router.push("/login"));
  }, [router, pathname]);

  function handleRoleSwitch(role: Role) {
    setActiveRole(role);
    const routes: Record<string, string> = {
      ADMIN: "/admin",
      DEV: "/dev",
      DONOR: "/donor",
    };
    router.push(routes[role]);
  }

  // Breadcrumb label derived from current pathname
  const breadcrumb = pathname.startsWith("/admin")
    ? "Admin / Treasury"
    : pathname.startsWith("/dev")
      ? "Dev / Board"
      : pathname.startsWith("/donor")
        ? "Donor / Overview"
        : "Dashboard";

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
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-tertiary">
            {breadcrumb}
          </span>
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
