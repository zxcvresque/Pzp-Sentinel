"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
          <div>
            <div className="text-xl font-bold">{user.name}</div>
            {user.telegramUser && (
              <div className="text-text-tertiary text-sm">@{user.telegramUser}</div>
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
    </div>
  );
}
