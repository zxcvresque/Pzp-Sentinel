"use client";

import { useEffect, useState } from "react";
import { getRoleColor } from "@/lib/role-colors";
import TgUser from "@/components/TgUser";
import FormExample from "@/components/FormExample";

interface User {
  id: string;
  name: string;
  telegramId: string;
  telegramUser: string;
  photoUrl?: string | null;
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

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add user form
  const [name, setName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [telegramUser, setTelegramUser] = useState("");
  const [roles, setRoles] = useState<string[]>(["DONOR"]);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setUsers(data.users || []))
      .catch((err) => console.error("Failed to load users:", err))
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

  // Pick a suggestion to prefill the Add User form
  function pickSuggestion(u: User) {
    setName(u.name);
    setTelegramId(u.telegramId);
    setTelegramUser(u.telegramUser);
    setRoles(["DONOR"]);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    // Check if this is an existing user without roles — use PATCH to assign roles instead of POST
    const existingNoRole = users.find(
      (u) => u.telegramId === telegramId && u.roles.length === 0
    );

    if (existingNoRole) {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: existingNoRole.id,
          roles,
          name: name || existingNoRole.name,
          telegramUser: telegramUser || existingNoRole.telegramUser,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) =>
          prev.map((u) => (u.id === existingNoRole.id ? { ...u, ...data.user } : u))
        );
        setShowForm(false);
        setName("");
        setTelegramId("");
        setTelegramUser("");
        setRoles(["DONOR"]);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to assign roles");
      }
      setSubmitting(false);
      return;
    }

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

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      }
    } catch {
      // silent
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  const pendingUsers = users.filter((u) => u.roles.length === 0);
  const activeUsers = users.filter((u) => u.roles.length > 0 && u.status === "ACTIVE");
  const inactiveUsers = users.filter((u) => u.roles.length > 0 && u.status === "INACTIVE");

  // Suggestions: users who /started the bot but have no roles and bot isn't blocked (chatId exists)
  const suggestions = users.filter(
    (u) => u.roles.length === 0 && u.chatId
  );

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
    const isInactive = u.status === "INACTIVE";

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
            <TgUser name={u.name} telegramUser={u.telegramUser} photoUrl={u.photoUrl} size={24} />
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
              {["ADMIN", "DONOR", "DEV"].map((role) => {
                const rc = getRoleColor(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleEditRole(role)}
                    className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded transition-colors cursor-pointer"
                    style={editState.roles.includes(role)
                      ? { background: rc.bg, color: rc.text, boxShadow: `inset 0 0 0 1px ${rc.border}` }
                      : { background: "var(--bg-deep)", color: "var(--text-tertiary)" }
                    }
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex gap-1 justify-center flex-wrap">
              {u.roles.map((r) => {
                const rc = getRoleColor(r);
                return (
                  <span
                    key={r}
                    className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
                    style={{ background: rc.bg, color: rc.text }}
                  >
                    {r}
                  </span>
                );
              })}
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
                {isInactive && (
                  <button
                    onClick={() => setDeleteTarget(u)}
                    title="Permanently delete"
                    className="px-2 py-1 rounded-full text-xs text-text-tertiary hover:text-coral hover:bg-coral/10 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
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
                <TgUser name={u.name} telegramUser={u.telegramUser} photoUrl={u.photoUrl} size={24} />
                <div className="text-text-tertiary text-xs mt-0.5">
                  @{u.telegramUser || u.telegramId} &middot; started bot {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </>
            )}
          </div>
          {isEditing ? (
            <div className="flex items-center gap-2">
              {["ADMIN", "DONOR", "DEV"].map((role) => {
                const rc = getRoleColor(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleEditRole(role)}
                    className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors"
                    style={editState.roles.includes(role)
                      ? { background: rc.bgSolid, color: "var(--bg-void)", borderColor: rc.bgSolid }
                      : { color: "var(--text-secondary)", borderColor: "var(--border)" }
                    }
                  >
                    {role}
                  </button>
                );
              })}
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => startEditing(u)}
                className="bg-amber/10 text-amber font-semibold px-4 py-1.5 rounded-full text-xs hover:bg-amber/20 transition-colors"
              >
                Assign Role
              </button>
              <button
                onClick={() => setDeleteTarget(u)}
                title="Delete"
                className="px-2 py-1.5 rounded-full text-text-tertiary hover:text-coral hover:bg-coral/10 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div
            className="card p-6 max-w-sm w-full mx-4 animate-scale-in"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-coral/10 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Delete user permanently?</h3>
                <p className="text-xs text-text-tertiary mt-0.5">This cannot be undone</p>
              </div>
            </div>

            <div className="bg-bg-deep rounded-lg p-3 mb-5">
              <div className="text-sm font-medium">{deleteTarget.name}</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                @{deleteTarget.telegramUser || deleteTarget.telegramId}
                {deleteTarget.roles.length > 0 && ` · ${deleteTarget.roles.join(", ")}`}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 disabled:opacity-40 transition-colors"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div className="card p-6 mb-6">
          {/* Suggestions from bot users without roles */}
          {suggestions.length > 0 && (
            <div className="mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2.5">
                Suggestions &mdash; started the bot, no role yet
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => pickSuggestion(u)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left ${
                      telegramId === u.telegramId
                        ? "border-lime/40 bg-lime/8"
                        : "border-[var(--border)] hover:border-[var(--border-hover)] hover:bg-[rgba(255,255,255,0.02)]"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-mint shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-text-primary">{u.name}</div>
                      <div className="text-[10px] text-text-tertiary">@{u.telegramUser || u.telegramId}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="h-px bg-[var(--border)] mt-4 mb-1" />
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-coral/8 border border-coral/20 text-coral text-sm">
                {error}
              </div>
            )}
            <FormExample lines={["Name: John Doe", "Telegram ID: 123456789 · Username: johndoe", "Roles: DONOR (or ADMIN, DEV)"]} />
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
                {["ADMIN", "DONOR", "DEV"].map((role) => {
                  const rc = getRoleColor(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleRole(role)}
                      className="font-mono text-[10px] uppercase tracking-[0.08em] px-4 py-2 rounded-full border transition-colors"
                      style={roles.includes(role)
                        ? { background: rc.bgSolid, color: "var(--bg-void)", borderColor: rc.bgSolid }
                        : { color: "var(--text-secondary)", borderColor: "var(--border)" }
                      }
                    >
                      {role}
                    </button>
                  );
                })}
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
        </div>
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
