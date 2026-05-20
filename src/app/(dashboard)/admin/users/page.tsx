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

interface EditState {
  roles: string[];
  name: string;
  telegramUser: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ roles: [], name: "", telegramUser: "" });
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  function toggleEditRole(role: string) {
    setEditState((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
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

  function startEditing(u: User) {
    setEditingId(u.id);
    setEditState({
      roles: [...u.roles],
      name: u.name,
      telegramUser: u.telegramUser,
    });
  }

  async function saveEdit(id: string) {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        roles: editState.roles,
        name: editState.name,
        telegramUser: editState.telegramUser,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id
            ? { ...u, roles: data.user.roles, name: data.user.name, telegramUser: data.user.telegramUser }
            : u
        )
      );
    }
    setEditingId(null);
  }

  async function toggleStatus(u: User) {
    const newStatus = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setTogglingId(u.id);
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, status: newStatus }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsers((prev) =>
        prev.map((existing) =>
          existing.id === u.id ? { ...existing, status: data.user.status } : existing
        )
      );
    }
    setTogglingId(null);
  }

  const pendingUsers = users.filter((u) => u.roles.length === 0);
  const activeUsers = users.filter((u) => u.roles.length > 0 && u.status === "ACTIVE");
  const inactiveUsers = users.filter((u) => u.roles.length > 0 && u.status === "INACTIVE");

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  function renderUserRow(u: User, dimmed: boolean) {
    const isEditing = editingId === u.id;
    const isToggling = togglingId === u.id;

    return (
      <tr
        key={u.id}
        className={`border-b border-[var(--border)] last:border-0 transition-colors ${
          dimmed ? "opacity-45" : "hover:bg-[rgba(255,255,255,0.02)]"
        }`}
      >
        <td className="p-4 text-sm font-medium">
          {isEditing ? (
            <input
              type="text"
              value={editState.name}
              onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
              className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
            />
          ) : (
            u.name
          )}
        </td>
        <td className="p-4 text-sm text-text-secondary">
          {isEditing ? (
            <div>
              <input
                type="text"
                value={editState.telegramUser}
                onChange={(e) => setEditState((s) => ({ ...s, telegramUser: e.target.value }))}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
              />
              <div className="text-text-tertiary text-xs mt-1">{u.telegramId}</div>
            </div>
          ) : (
            <div>
              <div>@{u.telegramUser || "—"}</div>
              <div className="text-text-tertiary text-xs">{u.telegramId}</div>
            </div>
          )}
        </td>
        <td className="p-4 text-center">
          {isEditing ? (
            <div className="flex gap-1 justify-center flex-wrap">
              {["ADMIN", "DONOR", "DEV"].map((role) => (
                <button
                  key={role}
                  onClick={() => toggleEditRole(role)}
                  className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    editState.roles.includes(role)
                      ? role === "ADMIN"
                        ? "bg-coral/20 text-coral ring-1 ring-coral/40"
                        : role === "DEV"
                          ? "bg-violet/20 text-violet ring-1 ring-violet/40"
                          : "bg-mint/20 text-mint ring-1 ring-mint/40"
                      : "bg-[var(--bg-deep)] text-text-tertiary"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          ) : (
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
          )}
        </td>
        <td className="p-4 text-center">
          <span className={`w-2 h-2 rounded-full inline-block ${u.chatId ? "bg-mint" : "bg-text-tertiary"}`} />
        </td>
        <td className="p-4 text-right text-text-secondary text-sm">
          {new Date(u.createdAt).toLocaleDateString()}
        </td>
        <td className="p-4 text-center">
          <div className="flex gap-1 justify-center items-center">
            {isEditing ? (
              <>
                <button
                  onClick={() => saveEdit(u.id)}
                  disabled={!editState.name.trim() || editState.roles.length === 0}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-lime/10 text-lime hover:bg-lime/20 disabled:opacity-40 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1 rounded-full text-xs text-text-tertiary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => startEditing(u)}
                  className="px-3 py-1 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleStatus(u)}
                  disabled={isToggling}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    u.status === "ACTIVE"
                      ? "bg-coral/10 text-coral hover:bg-coral/20"
                      : "bg-mint/10 text-mint hover:bg-mint/20"
                  } disabled:opacity-40`}
                >
                  {isToggling
                    ? "..."
                    : u.status === "ACTIVE"
                      ? "Deactivate"
                      : "Activate"}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function renderPendingCard(u: User) {
    const isEditing = editingId === u.id;

    return (
      <div key={u.id} className="card p-4 border-l-2 border-l-amber">
        <div className="flex items-center justify-between">
          <div>
            {isEditing ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={editState.name}
                  onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                  className="bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm font-semibold text-text-primary focus:outline-none focus:border-lime/30"
                />
                <input
                  type="text"
                  value={editState.telegramUser}
                  onChange={(e) => setEditState((s) => ({ ...s, telegramUser: e.target.value }))}
                  placeholder="@username"
                  className="bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-text-secondary focus:outline-none focus:border-lime/30"
                />
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold">{u.name}</div>
                <div className="text-text-tertiary text-xs mt-0.5">
                  @{u.telegramUser || u.telegramId} · started bot {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </>
            )}
          </div>
          {isEditing ? (
            <div className="flex items-center gap-2">
              {["ADMIN", "DONOR", "DEV"].map((role) => (
                <button
                  key={role}
                  onClick={() => toggleEditRole(role)}
                  className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors ${
                    editState.roles.includes(role)
                      ? role === "ADMIN"
                        ? "bg-coral text-bg-void border-coral"
                        : role === "DEV"
                          ? "bg-violet text-bg-void border-violet"
                          : "bg-mint text-bg-void border-mint"
                      : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
                  }`}
                >
                  {role}
                </button>
              ))}
              <button
                onClick={() => saveEdit(u.id)}
                disabled={editState.roles.length === 0 || !editState.name.trim()}
                className="bg-lime text-bg-void font-semibold px-4 py-1.5 rounded-full text-xs hover:bg-lime/90 disabled:opacity-40 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="text-text-tertiary text-xs hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => startEditing(u)}
              className="bg-amber/10 text-amber font-semibold px-4 py-1.5 rounded-full text-xs hover:bg-amber/20 transition-colors"
            >
              Assign Role
            </button>
          )}
        </div>
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

      {pendingUsers.length > 0 && (
        <div className="mb-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            Awaiting Role Assignment ({pendingUsers.length})
          </h2>
          <div className="space-y-3">
            {pendingUsers.map((u) => renderPendingCard(u))}
          </div>
        </div>
      )}

      {activeUsers.length === 0 && pendingUsers.length === 0 && inactiveUsers.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No users yet.</p>
          <p className="text-text-tertiary text-sm">Users will appear here when they start the bot.</p>
        </div>
      ) : (
        <>
          {activeUsers.length > 0 && (
            <div className="mb-8">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4">
                Active Members ({activeUsers.length})
              </h2>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Name</th>
                        <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Telegram</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Roles</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Bot</th>
                        <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Joined</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeUsers.map((u) => renderUserRow(u, false))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {inactiveUsers.length > 0 && (
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-text-tertiary" />
                Inactive ({inactiveUsers.length})
              </h2>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Name</th>
                        <th className="text-left p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Telegram</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Roles</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Bot</th>
                        <th className="text-right p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Joined</th>
                        <th className="text-center p-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactiveUsers.map((u) => renderUserRow(u, true))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
