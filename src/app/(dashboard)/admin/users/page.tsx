"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  name: string;
  telegramId: string;
  telegramUser: string;
  roles: string[];
  status: string;
  chatId: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [telegramUser, setTelegramUser] = useState("");
  const [roles, setRoles] = useState<string[]>(["DONOR"]);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .finally(() => setLoading(false));
  }, []);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, telegramId, telegramUser, roles }),
    });

    if (res.ok) {
      const data = await res.json();
      setUsers((prev) => [data.user, ...prev]);
      setShowForm(false);
      setName("");
      setTelegramId("");
      setTelegramUser("");
      setRoles(["DONOR"]);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to create user");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Manage <span className="font-display text-lime">Users</span>
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "Add User"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-coral/8 border border-coral/20 text-coral text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Telegram ID
              </label>
              <input
                type="text"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder="Numeric TG ID"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                TG Username
              </label>
              <input
                type="text"
                value={telegramUser}
                onChange={(e) => setTelegramUser(e.target.value)}
                placeholder="@username"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Roles
            </label>
            <div className="flex gap-2">
              {["ADMIN", "DONOR", "DEV"].map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`font-mono text-[10px] uppercase tracking-[0.08em] px-4 py-2 rounded-full border transition-colors ${
                    roles.includes(role)
                      ? "bg-lime text-bg-void border-lime"
                      : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !name || !telegramId || !telegramUser || roles.length === 0}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Creating..." : "Create User"}
          </button>
        </form>
      )}

      {users.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No users yet.</p>
          <p className="text-text-tertiary text-sm">Add the first community member.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Name</th>
                  <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Telegram</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Roles</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Status</th>
                  <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Bot</th>
                  <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <td className="p-4 text-sm font-medium">{u.name}</td>
                    <td className="p-4 text-sm text-text-secondary">
                      <div>@{u.telegramUser}</div>
                      <div className="text-text-tertiary text-xs">{u.telegramId}</div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded ${
                              r === "ADMIN"
                                ? "bg-coral/10 text-coral"
                                : r === "DEV"
                                  ? "bg-violet/10 text-violet"
                                  : "bg-mint/10 text-mint"
                            }`}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`font-mono text-[10px] uppercase ${u.status === "ACTIVE" ? "text-mint" : "text-text-tertiary"}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`w-2 h-2 rounded-full inline-block ${u.chatId ? "bg-mint" : "bg-text-tertiary"}`} />
                    </td>
                    <td className="p-4 text-right text-text-secondary text-sm">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
