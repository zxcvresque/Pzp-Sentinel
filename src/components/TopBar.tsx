"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface TopBarProps {
  name: string;
  photoUrl: string | null;
  telegramUser: string;
  roles: string[];
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  ADMIN: { bg: "rgba(200,255,0,0.10)", text: "var(--lime)" },
  DEV: { bg: "rgba(0,212,255,0.10)", text: "var(--cyan)" },
  DONOR: { bg: "rgba(255,184,0,0.10)", text: "var(--amber)" },
};

const ROLE_FALLBACK = { bg: "var(--bg-elevated)", text: "var(--text-tertiary)" };

export default function TopBar({ name, photoUrl, telegramUser, roles }: TopBarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const hasNotifications = false;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center gap-3">
      {/* ── Notifications ── */}
      <div ref={notifRef} className="relative">
        <button
          onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); }}
          className="relative w-9 h-9 rounded-full flex items-center justify-center border border-[var(--border)] bg-[var(--bg-deep)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] transition-all duration-200"
          title="Notifications"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 3a6 6 0 0 0-6 6v3.59l-.71.71A1 1 0 0 0 6 15h12a1 1 0 0 0 .71-1.7l-.71-.71V9a6 6 0 0 0-6-6Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 15v1a2 2 0 1 0 4 0v-1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {/* Notification badge dot */}
          {hasNotifications && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--coral)] ring-2 ring-[var(--bg-deep)]" />
          )}
        </button>

        {notifOpen && (
          <div
            className="absolute right-0 top-full mt-2.5 w-80 rounded-[14px] border border-[var(--border)] shadow-xl z-50 overflow-hidden animate-scale-in"
            style={{
              background: "rgba(12,12,15,0.82)",
              backdropFilter: "blur(20px) saturate(1.4)",
              WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            }}
          >
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Notifications
              </span>
            </div>

            <div className="flex flex-col items-center justify-center py-10 px-4 gap-3">
              {/* Muted bell icon for empty state */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--bg-elevated)]">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-[var(--text-tertiary)]"
                >
                  <path
                    d="M12 3a6 6 0 0 0-6 6v3.59l-.71.71A1 1 0 0 0 6 15h12a1 1 0 0 0 .71-1.7l-.71-.71V9a6 6 0 0 0-6-6Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 15v1a2 2 0 1 0 4 0v-1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-[var(--text-tertiary)] text-xs font-medium">
                All caught up
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Profile ── */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
          className="group relative w-9 h-9 rounded-full overflow-hidden transition-all duration-200 flex items-center justify-center"
          title={name}
          style={{
            boxShadow: "0 0 0 1.5px var(--border)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 0 0 1.5px rgba(200,255,0,0.35), 0 0 12px rgba(200,255,0,0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 0 0 1.5px var(--border)";
          }}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[var(--text-primary)]"
              style={{
                background: "linear-gradient(145deg, #1c1c22 0%, #111114 100%)",
              }}
            >
              {initials}
            </span>
          )}
        </button>

        {profileOpen && (
          <div
            className="absolute right-0 top-full mt-2.5 w-64 rounded-[14px] border border-[var(--border)] shadow-xl z-50 overflow-hidden animate-scale-in"
            style={{
              background: "rgba(12,12,15,0.82)",
              backdropFilter: "blur(20px) saturate(1.4)",
              WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            }}
          >
            {/* User info header */}
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                {/* Larger avatar in dropdown */}
                <div
                  className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
                  style={{
                    boxShadow: "0 0 0 1.5px var(--border)",
                  }}
                >
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span
                      className="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--text-primary)]"
                      style={{
                        background: "linear-gradient(145deg, #1c1c22 0%, #111114 100%)",
                      }}
                    >
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {name}
                  </div>
                  {telegramUser && (
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                      @{telegramUser}
                    </div>
                  )}
                </div>
              </div>

              {/* Role badges */}
              {roles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {roles.map((role) => {
                    const colors = ROLE_COLORS[role.toUpperCase()] ?? ROLE_FALLBACK;
                    return (
                      <span
                        key={role}
                        className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] px-2 py-[3px] rounded-md inline-flex items-center"
                        style={{
                          background: colors.bg,
                          color: colors.text,
                        }}
                      >
                        {role}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Menu items */}
            <div className="p-1.5">
              <Link
                href="/profile"
                onClick={() => setProfileOpen(false)}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-[10px] text-sm text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)] transition-all duration-200"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-50">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 20c0-3.31 3.13-6 7-6s7 2.69 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Profile
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-[10px] text-sm transition-all duration-200"
                style={{ color: "rgba(255,107,107,0.7)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--coral)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,107,107,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,107,107,0.7)";
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
                  <path d="M15 3H19C20.1 3 21 3.9 21 5V19C21 20.1 20.1 21 19 21H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10 17L15 12L10 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 12H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
