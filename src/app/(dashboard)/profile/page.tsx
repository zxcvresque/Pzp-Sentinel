"use client";

import { useEffect, useState, useRef } from "react";

interface UserProfile {
  id: string;
  name: string;
  telegramId: string;
  telegramUser: string;
  photoUrl: string | null;
  roles: string[];
}

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
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => {})
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

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full max-w-md rounded-xl" />
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

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-extrabold mb-8">
        <span className="font-display text-lime">Profile</span>
      </h1>

      <div className="card p-6">
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
                    className="bg-bg-elevated border border-[var(--border-hover)] rounded-lg px-3 py-1.5 text-lg font-bold text-text-primary outline-none focus:border-lime/40 w-full transition-colors"
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
              <div className="text-text-tertiary text-sm mt-0.5">@{user.telegramUser}</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
              Telegram ID
            </div>
            <div className="font-mono text-sm text-text-primary">{user.telegramId}</div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
              Username
            </div>
            <div className="text-sm text-text-primary">
              {user.telegramUser ? `@${user.telegramUser}` : "Not set"}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
              Roles
            </div>
            <div className="flex gap-2">
              {user.roles.map((role) => (
                <span
                  key={role}
                  className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1 rounded-full border border-[var(--border)] text-text-secondary"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="card p-6 mt-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Notification Preferences
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-amber/10 text-amber">
            Coming soon
          </span>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Bot DM notifications</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                Receive notifications via Telegram bot
              </div>
            </div>
            <button
              onClick={() => setBotDm(!botDm)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                botDm
                  ? "bg-lime/30"
                  : "bg-bg-elevated border border-[var(--border)]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                  botDm
                    ? "translate-x-5 bg-lime"
                    : "translate-x-0 bg-text-tertiary"
                }`}
              />
            </button>
          </div>

          <div className="h-px bg-[var(--border)]" />

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Email digest</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                Weekly summary of activity
              </div>
            </div>
            <button
              onClick={() => setEmailDigest(!emailDigest)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                emailDigest
                  ? "bg-lime/30"
                  : "bg-bg-elevated border border-[var(--border)]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
                  emailDigest
                    ? "translate-x-5 bg-lime"
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
