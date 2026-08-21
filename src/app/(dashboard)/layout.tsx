"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import SpotlightTour from "@/components/SpotlightTour";
import RoleOnboarding from "@/components/RoleOnboarding";
import { getTourSteps } from "@/lib/tour-steps";
import type { Role } from "@/generated/prisma/enums";

interface UserData {
  id: string;
  name: string;
  telegramUser: string;
  photoUrl: string | null;
  themeColor?: string;
  formLayout?: "SECTION_CARDS" | "ACCENT_RAILS" | "NUMBERED_WORKFLOW" | "INFORMATION_BANDS";
  onboardingVersion: number;
  githubUsername?: string | null;
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

function highestRoleRoute(roles: Role[]): string {
  if (roles.includes("ADMIN")) return "/admin";
  if (roles.includes("DEV")) return "/dev";
  return "/donor";
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
  const [tourRole, setTourRole] = useState<Role>("ADMIN");
  const [tourActive, setTourActive] = useState(false);
  const [introActive, setIntroActive] = useState(false);
  const [tourToast, setTourToast] = useState(false);
  const routeRole: Role = pathname.startsWith("/dev") ? "DEV" : pathname.startsWith("/donor") ? "DONOR" : "ADMIN";
  const onboardingRole: Role = user?.roles.includes(routeRole)
    ? routeRole
    : user?.roles.includes(activeRole) ? activeRole : user?.roles[0] || "DONOR";

  // Load the user, then keep it fresh by re-fetching on tab focus and on a short
  // interval. Each /api/auth/me call re-mints the auth cookie server-side with the
  // current DB roles, so a role granted OR revoked by an admin takes effect within
  // ~2 min (or instantly on tab focus) without a manual re-login.
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        const loadedUser = data.user as UserData;
        const pathRole: Role | null = pathname.startsWith("/admin") ? "ADMIN" : pathname.startsWith("/dev") ? "DEV" : pathname.startsWith("/donor") ? "DONOR" : null;
        const storedRole = localStorage.getItem(`sentinel_active_role_${loadedUser.id}`) as Role | null;
        const initialRole = pathRole && loadedUser.roles.includes(pathRole)
          ? pathRole
          : storedRole && loadedUser.roles.includes(storedRole)
            ? storedRole
            : loadedUser.roles[0] || "DONOR";
        setActiveRole(initialRole);
        setTourRole(initialRole);
        setUser(loadedUser);
        if (data.user.themeColor) {
          applyThemeColor(data.user.themeColor);
        }
        document.documentElement.dataset.formLayout = data.user.formLayout || "SECTION_CARDS";
      } catch {
        if (!cancelled) router.push("/login");
      }
    }

    loadUser();

    const onVisible = () => {
      if (document.visibilityState === "visible") loadUser();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(loadUser, 2 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every standalone user sees their own introduction once. Admins can hold all
  // roles, so remember the introduction independently for each switched view.
  useEffect(() => {
    if (!user) return;
    const introKey = `sentinel_intro_seen_${user.id}_${onboardingRole}`;
    const roleIntroSeen = localStorage.getItem(introKey) === "1";
    const shouldShowRoleIntro = !roleIntroSeen && ((user.onboardingVersion || 0) < 1 || user.roles.includes("ADMIN"));
    if (shouldShowRoleIntro) {
      const timer = window.setTimeout(() => setIntroActive(true), 0);
      return () => window.clearTimeout(timer);
    }
    const closeIntroTimer = window.setTimeout(() => setIntroActive(false), 0);
    const key = `sentinel_tour_seen_${user.id}_${onboardingRole}`;
    if (!localStorage.getItem(key) && !localStorage.getItem(`sentinel_page_tours_disabled_${user.id}_${onboardingRole}`)) {
      // Small delay so the page renders first
      setTourRole(onboardingRole);
      const timer = setTimeout(() => setTourActive(true), 800);
      return () => { window.clearTimeout(closeIntroTimer); clearTimeout(timer); };
    }
    return () => window.clearTimeout(closeIntroTimer);
  }, [user, onboardingRole]);

  async function completeIntro(startTours: boolean, githubUsername?: string) {
    if (!user) return false;
    const response = await fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingVersion: 1, ...(onboardingRole === "DEV" ? { githubUsername } : {}) }) });
    if (!response.ok) return false;
    localStorage.setItem(`sentinel_intro_seen_${user.id}_${onboardingRole}`, "1");
    setUser((current) => current ? { ...current, onboardingVersion: 1, ...(githubUsername ? { githubUsername } : {}) } : current);
    setIntroActive(false);
    setTourRole(onboardingRole);
    if (startTours) {
      localStorage.removeItem(`sentinel_page_tours_disabled_${user.id}_${onboardingRole}`);
      localStorage.removeItem(`sentinel_tour_seen_${user.id}_${onboardingRole}`);
      window.setTimeout(() => setTourActive(true), 300);
    } else {
      localStorage.setItem(`sentinel_tour_seen_${user.id}_${onboardingRole}`, "1");
      localStorage.setItem(`sentinel_page_tours_disabled_${user.id}_${onboardingRole}`, "1");
    }
    return true;
  }

  function handleTourFinish() {
    setTourActive(false);
    if (user) {
      localStorage.setItem(`sentinel_tour_seen_${user.id}_${tourRole}`, "1");
      window.dispatchEvent(new Event("sentinel-tour-gate-change"));
      setTourToast(true);
      setTimeout(() => setTourToast(false), 6000);
    }
  }

  // Derive activeRole from pathname whenever it (or the user's roles) changes.
  // If the user is viewing a role-gated section they no longer have access to
  // (e.g. an admin just revoked the role), bounce them to an allowed dashboard.
  useEffect(() => {
    if (!user) return;
    const roleFromPath: Role = pathname.startsWith("/admin")
      ? "ADMIN"
      : pathname.startsWith("/dev")
        ? "DEV"
        : "DONOR";
    const isGated =
      pathname.startsWith("/admin") ||
      pathname.startsWith("/dev") ||
      pathname.startsWith("/donor");
    if (isGated && !user.roles.includes(roleFromPath)) {
      router.replace(highestRoleRoute(user.roles));
      return;
    }
    if (isGated && user.roles.includes(roleFromPath)) {
      localStorage.setItem(`sentinel_active_role_${user.id}`, roleFromPath);
      const timer = window.setTimeout(() => setActiveRole(roleFromPath), 0);
      return () => window.clearTimeout(timer);
    } else if (!isGated) {
      const timer = window.setTimeout(() => setActiveRole((current) => user.roles.includes(current) ? current : user.roles[0]), 0);
      return () => window.clearTimeout(timer);
    }
  }, [pathname, user, router]);

  function handleRoleSwitch(role: Role) {
    setTourActive(false);
    setActiveRole(role);
    if (user) localStorage.setItem(`sentinel_active_role_${user.id}`, role);
    const routes: Record<string, string> = {
      ADMIN: "/admin",
      DEV: "/dev",
      DONOR: "/donor",
    };
    router.push(routes[role]);
  }

  useEffect(() => {
    document.documentElement.dataset.onboardingActive = introActive ? "1" : "0";
    document.documentElement.dataset.mainTourActive = tourActive ? "1" : "0";
    window.dispatchEvent(new Event("sentinel-tour-gate-change"));
    return () => {
      delete document.documentElement.dataset.onboardingActive;
      delete document.documentElement.dataset.mainTourActive;
    };
  }, [introActive, tourActive]);

  // Dynamic breadcrumb from pathname
  const breadcrumbMap: Record<string, string> = {
    "/admin": "Admin / Dashboard",
    "/admin/transactions": "Admin / Transactions",
    "/admin/transactions/new": "Admin / Transactions / Record transaction",
    "/admin/reconciliation": "Admin / Transactions / Reconciliation",
    "/admin/attention": "Admin / Needs Attention",
    "/admin/alerts": "Admin / Services / Operational alerts",
    "/admin/services": "Admin / Services",
    "/admin/donors": "Admin / Donors",
    "/admin/broadcasts": "Admin / Broadcasts",
    "/admin/users": "Admin / Users",
    "/admin/reminders": "Admin / Reminders",
    "/admin/credentials": "Admin / Credentials",
    "/admin/vps": "Admin / VPS Stats",
    "/admin/repos": "Admin / Repos",
    "/admin/audit": "Settings / Audit Log",
    "/dev": "Dev / Board",
    "/dev/tasks": "Dev / My Tasks",
    "/dev/vps": "Dev / VPS Stats",
    "/dev/credentials": "Dev / Credentials",
    "/donor": "Donor / Overview",
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
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 px-6 md:px-8 py-3 border-b border-[var(--border)]" style={{ background: "rgba(17,17,22,0.6)", backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)" }}>
          <div data-tour="breadcrumb" className="flex items-center gap-1.5">
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
        <main className="min-w-0 flex-1 p-6 pb-24 md:p-8 md:pb-8">
          <div key={pathname} className="page-transition min-w-0">
            {children}
          </div>
        </main>
      </div>
      <div className="grain" />
      <SpotlightTour
        steps={getTourSteps(tourRole)}
        active={tourActive}
        onFinish={handleTourFinish}
      />
      {introActive && <RoleOnboarding key={onboardingRole} role={onboardingRole} name={user.name} photoUrl={user.photoUrl} githubUsername={user.githubUsername} requireGithub={onboardingRole === "DEV"} onComplete={completeIntro} />}

      {/* Tour reminder toast */}
      {tourToast && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "12px 20px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: 420,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--lime)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            You can replay the tour anytime from{" "}
            <button
              onClick={() => { setTourToast(false); router.push("/profile"); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--lime)",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                fontSize: 13,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Settings
            </button>
          </span>
          <button
            onClick={() => setTourToast(false)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 4,
              marginLeft: 4,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
