"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import BroadcastContent, { BroadcastInlineContent } from "@/components/BroadcastContent";
import { notificationDestination } from "@/lib/notification-destination";

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

export default function TopBar({ name, photoUrl, telegramUser, roles }: TopBarProps) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.read);
  const unreadCount = serverUnreadCount;
  const hasHighPriority = unread.some((n) => n.priority === "HIGH");
  const broadcast = unread.find(
    (notification) => notification.priority === "HIGH" && notification.entityId?.startsWith("broadcast:"),
  );

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?includeRead=true&limit=50");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
        setServerUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  // Fetch on mount; the hook then refreshes on tab focus and every 15s.
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchNotifications(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchNotifications]);
  useAutoRefresh(fetchNotifications, 15_000);

  // Re-fetch when dropdown opens
  useEffect(() => {
    if (!notifOpen) return;
    const timer = window.setTimeout(() => { void fetchNotifications(); }, 0);
    return () => window.clearTimeout(timer);
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
      setServerUnreadCount((count) => Math.max(0, count - notifications.filter((item) => ids.includes(item.id) && !item.read).length));
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
      setServerUnreadCount(0);
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
      {broadcast && createPortal(
        <aside
          role="alertdialog"
          aria-labelledby={`broadcast-title-${broadcast.id}`}
          aria-describedby={`broadcast-message-${broadcast.id}`}
          className="fixed inset-x-3 top-3 z-[9997] mx-auto w-auto max-w-md overflow-hidden rounded-2xl border border-lime/25 bg-[var(--bg-card)] shadow-2xl animate-scale-in sm:inset-x-auto sm:right-5 sm:top-5 sm:w-[400px]"
        >
          <div className="h-1 bg-gradient-to-r from-lime via-mint to-violet" />
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime/10 text-lime">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 11v2a2 2 0 0 0 2 2h2l4 4V5L7 9H5a2 2 0 0 0-2 2Z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18 6a8.5 8.5 0 0 1 0 12" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-lime">Sentinel announcement</div>
                <h2 id={`broadcast-title-${broadcast.id}`} className="mt-1 text-base font-bold text-[var(--text-primary)]">
                  <BroadcastInlineContent message={broadcast.title} />
                </h2>
                <div id={`broadcast-message-${broadcast.id}`} className="mt-2 text-[var(--text-secondary)]">
                  <BroadcastContent message={broadcast.message} />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => markRead([broadcast.id])}
                className="rounded-full bg-lime px-5 py-2 text-xs font-semibold text-bg-void transition-colors hover:bg-lime/90"
              >
                Got it
              </button>
            </div>
          </div>
        </aside>,
        document.body,
      )}

      {/* ── Notifications ── */}
      <style>{`
        @keyframes bell-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div ref={notifRef} className="relative z-50" data-tour="notifications">
        <button
          onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); }}
          className="relative w-9 h-9 rounded-full flex items-center justify-center border border-[var(--border)] bg-[var(--bg-deep)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] transition-all duration-200"
          style={hasHighPriority ? { color: "var(--coral)", animation: "bell-pulse 2s ease-in-out infinite" } : undefined}
          title="Notifications"
          aria-label="Notifications"
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
                      const href = notificationDestination({ type: notif.type, roles, entityId: notif.entityId });
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
      <div ref={profileRef} className="relative z-50" data-tour="profile">
        <button
          onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
          className="group relative w-9 h-9 rounded-full overflow-hidden transition-all duration-200 flex items-center justify-center"
          title={name}
          aria-label="Profile menu"
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
          {photoUrl && !avatarImgError ? (
            <img
              src={photoUrl}
              alt={name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setAvatarImgError(true)}
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
                  {photoUrl && !avatarImgError ? (
                    <img
                      src={photoUrl}
                      alt={name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarImgError(true)}
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
                  <path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M19.14 15.7a1.5 1.5 0 00.3 1.65l.05.06a1.82 1.82 0 11-2.57 2.57l-.06-.06a1.5 1.5 0 00-1.65-.3 1.5 1.5 0 00-.91 1.37v.17a1.82 1.82 0 11-3.64 0v-.09A1.5 1.5 0 009.3 19.6a1.5 1.5 0 00-1.65.3l-.06.06a1.82 1.82 0 11-2.57-2.57l.06-.06a1.5 1.5 0 00.3-1.65 1.5 1.5 0 00-1.37-.91h-.17a1.82 1.82 0 110-3.64h.09A1.5 1.5 0 005.4 9.3a1.5 1.5 0 00-.3-1.65l-.06-.06a1.82 1.82 0 112.57-2.57l.06.06a1.5 1.5 0 001.65.3h.07a1.5 1.5 0 00.91-1.37v-.17a1.82 1.82 0 013.64 0v.09a1.5 1.5 0 00.91 1.37 1.5 1.5 0 001.65-.3l.06-.06a1.82 1.82 0 112.57 2.57l-.06.06a1.5 1.5 0 00-.3 1.65v.07a1.5 1.5 0 001.37.91h.17a1.82 1.82 0 010 3.64h-.09a1.5 1.5 0 00-1.37.91z" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                Settings
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
