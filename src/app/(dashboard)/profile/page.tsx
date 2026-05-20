"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ThemeColorPicker from "@/components/ThemeColorPicker";

interface UserProfile {
  id: string;
  name: string;
  telegramId: string;
  telegramUser: string;
  photoUrl: string | null;
  themeColor?: string;
  chatId: string | null;
  roles: string[];
  createdAt: string | null;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ADMIN: { bg: "rgba(99,102,241,0.12)", text: "var(--lime)", border: "rgba(99,102,241,0.25)" },
  DEV: { bg: "rgba(56,189,248,0.12)", text: "var(--cyan)", border: "rgba(56,189,248,0.25)" },
  DONOR: { bg: "rgba(251,191,36,0.12)", text: "var(--amber)", border: "rgba(251,191,36,0.25)" },
};

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Name editing state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Notification preference toggles (visual only)
  const [botDm, setBotDm] = useState(false);
  const [emailDigest, setEmailDigest] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json();
      })
      .then((data) => setUser(data?.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    if (!user) return;
    setDraft(user.name);
    setError("");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft("");
    setError("");
  }

  async function saveName() {
    if (!user) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    if (trimmed === user.name) {
      cancelEditing();
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update name");
      }
      const data = await res.json();
      setUser(data.user);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") saveName();
    if (e.key === "Escape") cancelEditing();
  }

  const handleThemeChange = useCallback(
    async (hex: string) => {
      if (!user) return;
      // Optimistic local update
      setUser((prev) => (prev ? { ...prev, themeColor: hex } : prev));
      // Apply CSS variables immediately
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      document.documentElement.style.setProperty("--lime", hex);
      document.documentElement.style.setProperty("--lime-dim", `rgba(${r},${g},${b},0.08)`);
      document.documentElement.style.setProperty("--lime-glow", `rgba(${r},${g},${b},0.12)`);
      document.documentElement.style.setProperty("--border-active", `rgba(${r},${g},${b},0.3)`);
      // Persist
      try {
        await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeColor: hex }),
        });
      } catch {
        // Silently fail — optimistic UI stays
      }
    },
    [user],
  );

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full max-w-lg rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="card p-8 text-center">
        <p className="text-text-secondary">Could not load profile.</p>
      </div>
    );
  }

  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const joinedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-extrabold mb-8">
        <span className="font-display text-lime">Profile</span>
      </h1>

      {/* Main profile card */}
      <div className="card p-6">
        {/* Avatar and name */}
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[var(--border)] bg-bg-deep flex items-center justify-center shrink-0">
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={user.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-xl font-bold text-text-secondary">
                {initials}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div>
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={saving}
                    maxLength={100}
                    className="bg-bg-elevated border border-[var(--border-hover)] rounded-lg px-3 py-1.5 text-lg font-bold text-text-primary outline-none focus:border-[var(--border-active)] w-full transition-colors"
                  />
                  <button
                    onClick={saveName}
                    disabled={saving}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-lime/10 text-lime text-xs font-mono uppercase tracking-wider hover:bg-lime/20 transition-colors disabled:opacity-50"
                  >
                    {saving ? "..." : "Save"}
                  </button>
                  <button
                    onClick={cancelEditing}
                    disabled={saving}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-xs font-mono uppercase tracking-wider hover:bg-bg-hover transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                {error && (
                  <p className="text-coral text-xs mt-1.5">{error}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="text-xl font-bold truncate">{user.name}</div>
                <button
                  onClick={startEditing}
                  className="shrink-0 px-2 py-0.5 rounded-md text-text-tertiary text-xs font-mono uppercase tracking-wider hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                >
                  Edit
                </button>
              </div>
            )}
            {user.telegramUser && (
              <div className="text-text-tertiary text-sm mt-0.5">
                @{user.telegramUser}
              </div>
            )}
          </div>
        </div>

        {/* Role badges */}
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2.5">
            Roles
          </div>
          <div className="flex flex-wrap gap-2">
            {user.roles.map((role) => {
              const colors = ROLE_COLORS[role] || {
                bg: "rgba(228,228,232,0.08)",
                text: "var(--text-secondary)",
                border: "rgba(228,228,232,0.15)",
              };
              return (
                <span
                  key={role}
                  className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full font-semibold"
                  style={{
                    background: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  {role}
                </span>
              );
            })}
          </div>
        </div>

        {/* Details */}
        <div className="space-y-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
              Telegram ID
            </div>
            <div className="font-mono text-sm text-text-primary">
              {user.telegramId}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
              Username
            </div>
            <div className="text-sm text-text-primary">
              {user.telegramUser ? `@${user.telegramUser}` : "Not set"}
            </div>
          </div>

          {/* Telegram connection status */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
              Telegram Bot
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  user.chatId ? "bg-mint" : "bg-text-tertiary"
                }`}
              />
              <span
                className={`text-sm ${
                  user.chatId ? "text-mint" : "text-text-secondary"
                }`}
              >
                {user.chatId ? "Connected" : "Not connected"}
              </span>
            </div>
            {!user.chatId && (
              <p className="text-text-tertiary text-[11px] mt-1">
                Start a chat with the bot on Telegram to connect
              </p>
            )}
          </div>

          {/* Joined date */}
          {joinedDate && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
                Joined
              </div>
              <div className="text-sm text-text-primary">{joinedDate}</div>
            </div>
          )}
        </div>
      </div>

      {/* Theme */}
      <div className="card p-6 mt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
          Theme
        </div>
        <div className="text-sm text-text-secondary mb-3">
          Pick an accent colour that applies across the app.
        </div>
        <ThemeColorPicker
          value={user.themeColor || "#ffffff"}
          onChange={handleThemeChange}
        />
      </div>

      {/* Notification Preferences */}
      <div className="card p-6 mt-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Notification Preferences
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-amber/10 text-amber border border-amber/20">
            Coming soon
          </span>
        </div>

        <div className="space-y-0">
          {/* Bot DM toggle */}
          <div className="flex items-center justify-between py-4 border-b border-[var(--border)]">
            <div className="pr-4">
              <div className="text-sm text-text-primary font-medium">
                Bot DM notifications
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                Receive transaction updates and alerts via Telegram bot
              </div>
            </div>
            <button
              onClick={() => setBotDm(!botDm)}
              aria-label="Toggle bot DM notifications"
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                botDm
                  ? "bg-lime/30"
                  : "bg-bg-elevated border border-[var(--border)]"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-all duration-200 ${
                  botDm
                    ? "translate-x-5 bg-lime shadow-[0_0_8px_rgba(99,102,241,0.3)]"
                    : "translate-x-0 bg-text-tertiary"
                }`}
              />
            </button>
          </div>

          {/* Email digest toggle */}
          <div className="flex items-center justify-between py-4">
            <div className="pr-4">
              <div className="text-sm text-text-primary font-medium">
                Email digest
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                Weekly summary of donations, approvals, and community activity
              </div>
            </div>
            <button
              onClick={() => setEmailDigest(!emailDigest)}
              aria-label="Toggle email digest"
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                emailDigest
                  ? "bg-lime/30"
                  : "bg-bg-elevated border border-[var(--border)]"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-all duration-200 ${
                  emailDigest
                    ? "translate-x-5 bg-lime shadow-[0_0_8px_rgba(99,102,241,0.3)]"
                    : "translate-x-0 bg-text-tertiary"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
