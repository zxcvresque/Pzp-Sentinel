"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface TopBarProps {
  name: string;
  photoUrl: string | null;
  telegramUser: string;
  roles: string[];
}

export default function TopBar({ name, photoUrl, telegramUser, roles }: TopBarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

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
    <div className="flex items-center gap-2">
      {/* Notifications */}
      <div ref={notifRef} className="relative">
        <button
          onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); }}
          className="w-9 h-9 rounded-full flex items-center justify-center border border-[var(--border)] bg-bg-deep text-text-tertiary hover:text-text-primary hover:border-[var(--border-hover)] transition-colors"
          title="Notifications"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6v2.5L2 10.5v1h12v-1L12.5 8.5V6c0-2.5-2-4.5-4.5-4.5zM6.5 12.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 bg-bg-deepest border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Notifications
              </span>
            </div>
            <div className="p-6 text-center">
              <p className="text-text-tertiary text-xs">No notifications yet</p>
            </div>
          </div>
        )}
      </div>

      {/* Profile */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
          className="w-9 h-9 rounded-full overflow-hidden border border-[var(--border)] hover:border-lime/40 transition-colors flex items-center justify-center bg-bg-deep"
          title={name}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-xs font-semibold text-text-secondary">
              {initials}
            </span>
          )}
        </button>

        {profileOpen && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-bg-deepest border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]">
              <div className="text-sm font-semibold text-text-primary">{name}</div>
              {telegramUser && (
                <div className="text-xs text-text-tertiary mt-0.5">@{telegramUser}</div>
              )}
              <div className="flex gap-1.5 mt-2">
                {roles.map((role) => (
                  <span
                    key={role}
                    className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-text-tertiary"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
            <div className="p-2">
              <Link
                href="/profile"
                onClick={() => setProfileOpen(false)}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-[rgba(255,255,255,0.03)] hover:text-text-primary transition-colors"
              >
                Profile
              </Link>
              <button
                onClick={handleLogout}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm text-coral/80 hover:bg-coral/5 hover:text-coral transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
