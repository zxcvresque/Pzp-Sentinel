"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import type { Role } from "@/generated/prisma";

interface UserData {
  id: string;
  name: string;
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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-lime/30 border-t-lime rounded-full animate-spin" />
          <span className="text-text-tertiary text-sm">Loading...</span>
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
      <main className="flex-1 p-6 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
