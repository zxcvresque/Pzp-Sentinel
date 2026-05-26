"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface TopBarProps {
  name: string;
  photoUrl: string | null;
  telegramUser: string;
  roles: string[];
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  priority: "LOW" | "NORMAL" | "HIGH";
  entityId: string | null;
  createdAt: string;
}

import { getRoleColor } from "@/lib/role-colors";

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function getNotificationHref(notif: Notification, roles: string[]): string | null {
  const isAdmin = roles.includes("ADMIN");
  switch (notif.type) {
    case "TX_PENDING":
    case "TX_APPROVED":
    case "TX_REJECTED":
      return isAdmin ? "/admin/transactions" : "/donor/receipts";
    case "TASK_ASSIGNED":
      return "/dev/tasks";
    case "CREDENTIAL_ASSIGNED":
    case "CREDENTIAL_REVIEWED":
      return isAdmin ? "/admin/credentials" : "/dev/credentials";
    case "USER_REGISTERED":
      return "/admin/users";
    case "ROLE_ASSIGNED":
      return "/profile";
    default:
      return null;
  }
}

export default function TopBar({ name, photoUrl, telegramUser, roles }: TopBarProps) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.read);
  const unreadCount = unread.length;
  const hasHighPriority = unread.some((n) => n.priority === "HIGH");

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  // Fetch on mount + poll every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Re-fetch when dropdown opens
  useEffect(() => {
    if (notifOpen) fetchNotifications();
  }, [notifOpen, fetchNotifications]);

  async function markRead(ids: string[]) {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
      );
    } catch {
      // silently ignore
    }
  }

  async function markAllRead() {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // silently ignore
    }
  }

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
      <style>{`
        @keyframes bell-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div ref={notifRef} className="relative z-50">
        <button
          onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); }}
          className="relative w-9 h-9 rounded-full flex items-center justify-center border border-[var(--border)] bg-[var(--bg-deep)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] transition-all duration-200"
          style={hasHighPriority ? { color: "var(--coral)", animation: "bell-pulse 2s ease-in-out infinite" } : undefined}
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

          {/* Notification badge with count */}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-[var(--coral)] ring-2 ring-[var(--bg-deep)] flex items-center justify-center px-1">
              <span className="text-[9px] font-bold text-white leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </span>
          )}
        </button>

        {notifOpen && (
          <div
            className="absolute right-0 top-full mt-2.5 w-80 rounded-[14px] border border-[var(--border)] shadow-2xl z-50 overflow-hidden animate-scale-in"
            style={{
              background: "var(--bg-card)",
            }}
          >
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Notifications
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--coral)] hover:opacity-80 transition-opacity"
                >
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 gap-3">
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
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: "380px" }}>
                {notifications.slice(0, 20).map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => {
                      if (!notif.read) markRead([notif.id]);
                      const href = getNotificationHref(notif, roles);
                      if (href) {
                        setNotifOpen(false);
                        router.push(href);
                      }
                    }}
                    className="w-full text-left px-4 py-3 flex gap-3 border-b border-[var(--border)] last:border-b-0 transition-colors duration-150 cursor-pointer"
                    style={{
                      background: notif.read ? "transparent" : "var(--bg-elevated)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = notif.read ? "transparent" : "var(--bg-elevated)";
                    }}
                  >
                    {/* Priority indicator bar */}
                    <div className="flex-shrink-0 pt-1">
                      <div
                        className="w-1 h-8 rounded-full"
                        style={{
                          background:
                            notif.priority === "HIGH"
                              ? "var(--coral)"
                              : notif.priority === "NORMAL"
                                ? "var(--text-tertiary)"
                                : "transparent",
                        }}
                      />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-[13px] truncate"
                          style={{
                            color: "var(--text-primary)",
                            fontWeight: notif.read ? 400 : 600,
                          }}
                        >
                          {notif.title}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 font-mono">
                          {timeAgo(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 line-clamp-2 leading-[1.4]">
                        {notif.message}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Profile ── */}
      <div ref={profileRef} className="relative z-50">
        <button
          onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
          className="group relative w-9 h-9 rounded-full overflow-hidden transition-all duration-200 flex items-center justify-center"
          title={name}
          style={{
            boxShadow: "0 0 0 1.5px var(--border)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 0 0 1.5px rgba(99,102,241,0.30), 0 0 12px rgba(99,102,241,0.08)";
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
                background: "linear-gradient(145deg, #26262f 0%, #1a1a22 100%)",
              }}
            >
              {initials}
            </span>
          )}
        </button>

        {profileOpen && (
          <div
            className="absolute right-0 top-full mt-2.5 w-64 rounded-[14px] border border-[var(--border)] shadow-2xl z-50 overflow-hidden animate-scale-in"
            style={{
              background: "var(--bg-card)",
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
                        background: "linear-gradient(145deg, #26262f 0%, #1a1a22 100%)",
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
                    const colors = getRoleColor(role);
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
