"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ThemeColorPicker from "@/components/ThemeColorPicker";
import { getRoleColor } from "@/lib/role-colors";
import { useFormExamples } from "@/hooks/useFormExamples";

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
  dmPreferences: string[];
  savedColors: string[];
}

const DM_CATEGORIES = [
  { label: "Transactions", types: ["TX_PENDING", "TX_APPROVED", "TX_REJECTED"], desc: "New donations, approvals & rejections" },
  { label: "Tasks", types: ["TASK_ASSIGNED"], desc: "Task assignments" },
  { label: "Credentials", types: ["CREDENTIAL_ASSIGNED", "CREDENTIAL_REVIEWED"], desc: "Shared credentials & reviews" },
  { label: "System", types: ["SYSTEM", "USER_REGISTERED"], desc: "BMC donations, sync, admin alerts" },
  { label: "Roles", types: ["ROLE_ASSIGNED"], desc: "Role changes" },
  { label: "Reminders", types: ["REMINDER"], desc: "Payment & task reminders" },
] as const;

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [savedColors, setSavedColors] = useState<string[]>([]);
  const [dmPrefs, setDmPrefs] = useState<string[]>([]);
  const [dmSaving, setDmSaving] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const { showExamples, hideExamples, enableExamples } = useFormExamples();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json();
      })
      .then((data) => {
        const u = data?.user || null;
        setUser(u);
        setSavedColors(u?.savedColors || []);
        if (u?.dmPreferences) setDmPrefs(u.dmPreferences);
      })
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

  const [themeSaved, setThemeSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [themeError, setThemeError] = useState("");

  const handleThemeChange = useCallback(
    async (hex: string) => {
      if (!user) return;
      setUser((prev) => (prev ? { ...prev, themeColor: hex } : prev));
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      document.documentElement.style.setProperty("--lime", hex);
      document.documentElement.style.setProperty("--lime-dim", `rgba(${r},${g},${b},0.08)`);
      document.documentElement.style.setProperty("--lime-glow", `rgba(${r},${g},${b},0.12)`);
      document.documentElement.style.setProperty("--border-active", `rgba(${r},${g},${b},0.3)`);
      setThemeSaved("saving");
      setThemeError("");
      try {
        const res = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeColor: hex }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setThemeSaved("saved");
        setTimeout(() => setThemeSaved("idle"), 1500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        setThemeError(msg);
        setThemeSaved("error");
        setTimeout(() => setThemeSaved("idle"), 4000);
      }
    },
    [user],
  );

  async function saveColorToSlot(index: number) {
    if (!user) return;
    const currentColor = user.themeColor || "#6FD1D7";
    const newSaved = [...savedColors];
    newSaved[index] = currentColor;
    while (newSaved.length <= index) newSaved.push(currentColor);
    const trimmed = newSaved.slice(0, 3);
    setSavedColors(trimmed);
    try {
      await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedColors: trimmed }),
      });
    } catch {
      setSavedColors(savedColors);
    }
  }

  async function removeColorFromSlot(index: number) {
    const newSaved = savedColors.filter((_, idx) => idx !== index);
    setSavedColors(newSaved);
    try {
      await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedColors: newSaved }),
      });
    } catch {
      setSavedColors(savedColors);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-20 md:pb-0">
        <div className="skeleton h-48 rounded-xl" />
        <div className="skeleton h-48 rounded-xl" />
        <div className="skeleton h-48 rounded-xl" />
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
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="pb-20 md:pb-0">
      <h1 className="text-2xl font-extrabold mb-4">
        <span className="font-display text-lime">Settings</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Col 1: Identity + Preferences ── */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[var(--border)] bg-bg-deep flex items-center justify-center shrink-0">
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-base font-bold text-text-secondary">
                  {initials}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <div>
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <input
                      ref={inputRef}
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={saving}
                      maxLength={100}
                      className="bg-bg-elevated border border-[var(--border-hover)] rounded-md px-2 py-1 text-sm font-bold text-text-primary outline-none focus:border-[var(--border-active)] min-w-0 flex-1 transition-colors"
                    />
                    <button
                      onClick={saveName}
                      disabled={saving}
                      className="shrink-0 px-1.5 sm:px-2 py-1 rounded-md bg-lime/10 text-lime text-[10px] font-mono uppercase tracking-wider hover:bg-lime/20 transition-colors disabled:opacity-50"
                    >
                      {saving ? "..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEditing}
                      disabled={saving}
                      className="shrink-0 px-1.5 sm:px-2 py-1 rounded-md bg-bg-elevated text-text-secondary text-[10px] font-mono uppercase tracking-wider hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      Esc
                    </button>
                  </div>
                  {error && <p className="text-coral text-[10px] mt-1">{error}</p>}
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold truncate">{user.name}</span>
                    <button
                      onClick={startEditing}
                      className="shrink-0 text-text-tertiary text-[10px] font-mono uppercase tracking-wider hover:text-text-secondary transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-text-tertiary text-xs">@{user.telegramUser}</div>
                </div>
              )}
            </div>
          </div>

          {/* Roles */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {user.roles.map((role) => {
              const c = getRoleColor(role);
              return (
                <span
                  key={role}
                  className="font-mono text-[9px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full font-semibold"
                  style={{
                    background: c.bg,
                    color: c.text,
                    border: `1px solid ${c.border}`,
                  }}
                >
                  {role}
                </span>
              );
            })}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
                Telegram ID
              </div>
              <div className="font-mono text-xs text-text-primary">{user.telegramId}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
                Bot Status
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${user.chatId ? "bg-mint" : "bg-text-tertiary"}`} />
                <span className={`text-xs ${user.chatId ? "text-mint" : "text-text-secondary"}`}>
                  {user.chatId ? "Connected" : "Not linked"}
                </span>
              </div>
            </div>
            {joinedDate && (
              <div className="col-span-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
                  Joined
                </div>
                <div className="text-xs text-text-primary">{joinedDate}</div>
              </div>
            )}
          </div>

          {/* ── Preferences ── */}
          <div className="pt-4 border-t border-[var(--border)]">
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
              Preferences
            </div>
            <div className="flex items-center justify-between py-1">
              <div className="pr-3 min-w-0">
                <div className="text-xs font-medium text-text-primary">Form Examples</div>
                <div className="text-[11px] text-text-secondary mt-0.5">
                  Show contextual hints in forms
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showExamples}
                onClick={() => (showExamples ? hideExamples() : enableExamples())}
                className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200 cursor-pointer ${
                  showExamples
                    ? "bg-lime/30"
                    : "bg-bg-elevated border border-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                    showExamples
                      ? "translate-x-4 bg-lime"
                      : "translate-x-0 bg-text-tertiary"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* ── Col 2: Theme ── */}
        <div className="card p-4 sm:p-5 flex flex-col">
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
            Accent Colour
          </div>
          <div className="text-xs text-text-secondary mb-3">
            Pick a colour that applies across the entire app. Resets to white by default.
          </div>

          {/* Saved colour presets */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4 mb-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary shrink-0">
              Saved
            </span>
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => {
                const color = savedColors[i];
                const isActive = color && user.themeColor === color;

                if (color) {
                  return (
                    <div key={i} className="relative group">
                      <button
                        onClick={() => handleThemeChange(color)}
                        title={`Apply ${color}`}
                        className={`w-7 h-7 rounded-full border-2 transition-all duration-200 hover:scale-110 ${
                          isActive ? "border-white/40 ring-1 ring-white/20" : "border-[var(--border)] hover:border-[var(--border-hover)]"
                        }`}
                        style={{ background: color }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeColorFromSlot(i);
                        }}
                        title="Remove saved colour"
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-bg-card border border-[var(--border)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-coral hover:text-coral text-text-tertiary"
                      >
                        <span className="text-[9px] leading-none">×</span>
                      </button>
                    </div>
                  );
                }

                return (
                  <button
                    key={i}
                    onClick={() => saveColorToSlot(i)}
                    title="Save current colour"
                    className="w-7 h-7 rounded-full border-2 border-dashed border-[var(--border)] hover:border-[var(--border-hover)] transition-colors flex items-center justify-center group"
                  >
                    <span className="text-text-tertiary text-[10px] group-hover:text-text-secondary">+</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-auto">
            <ThemeColorPicker
              value={user.themeColor || "#6FD1D7"}
              onChange={handleThemeChange}
            />
          </div>

          {/* Hex input + save status */}
          <div className="mt-4 flex items-center gap-1.5 sm:gap-2">
            <div
              className="w-5 h-5 rounded-full border border-[var(--border)] shrink-0"
              style={{ background: user.themeColor || "#6FD1D7" }}
            />
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-tertiary pointer-events-none">
                #
              </span>
              <input
                type="text"
                maxLength={6}
                placeholder="FFFFFF"
                value={hexDraft !== null ? hexDraft : (user.themeColor || "#6FD1D7").replace("#", "").toUpperCase()}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  setHexDraft(raw.toUpperCase());
                  if (raw.length === 6) {
                    handleThemeChange(`#${raw}`);
                    setHexDraft(null);
                  }
                }}
                onBlur={() => setHexDraft(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const raw = (e.target as HTMLInputElement).value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                    if (raw.length === 6) {
                      handleThemeChange(`#${raw}`);
                      setHexDraft(null);
                    }
                  }
                }}
                className="w-full bg-bg-elevated border border-[var(--border)] rounded-md pl-5 pr-2 py-1 font-mono text-[11px] text-text-primary uppercase tracking-wider outline-none focus:border-[var(--border-active)] transition-colors"
              />
            </div>
            <span className="font-mono text-[9px] tracking-wider shrink-0 text-right max-w-[80px] sm:max-w-[120px] truncate" title={themeError || undefined}>
              {themeSaved === "saving" && <span className="text-text-tertiary uppercase">saving</span>}
              {themeSaved === "saved" && <span className="text-mint uppercase">saved</span>}
              {themeSaved === "error" && <span className="text-coral">{themeError || "failed"}</span>}
            </span>
          </div>
        </div>

        {/* ── Col 3: Notifications ── */}
        <div className="card p-4 sm:p-5">
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary mb-1">
            Notifications
          </div>
          <div className="text-[11px] text-text-secondary mb-4">
            {user.chatId ? (
              <>Linked via <span className="text-text-primary font-medium">@TheSentinelRobot</span></>
            ) : (
              <>Not linked — start <span className="text-text-primary font-medium">@TheSentinelRobot</span></>
            )}
          </div>

          <div className="space-y-0 divide-y divide-[var(--border)]">
            {DM_CATEGORIES.map((cat) => {
              const isOn = cat.types.every((t) => dmPrefs.includes(t));
              const disabled = !user.chatId;

              async function toggle() {
                if (disabled) return;
                const newPrefs = isOn
                  ? dmPrefs.filter((p) => !(cat.types as readonly string[]).includes(p))
                  : [...dmPrefs, ...cat.types.filter((t) => !dmPrefs.includes(t))];
                setDmPrefs(newPrefs);
                setDmSaving(true);
                try {
                  await fetch("/api/auth/me", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dmPreferences: newPrefs }),
                  });
                } catch {
                  setDmPrefs(dmPrefs);
                } finally {
                  setDmSaving(false);
                }
              }

              return (
                <div key={cat.label} className="flex items-center justify-between py-2.5">
                  <div className="pr-3 min-w-0">
                    <div className={`text-xs font-medium ${disabled ? "text-text-tertiary" : "text-text-primary"}`}>
                      {cat.label}
                    </div>
                    <div className="text-[11px] text-text-secondary mt-0.5 break-words">
                      {cat.desc}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOn}
                    disabled={disabled}
                    onClick={toggle}
                    className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200 ${
                      disabled
                        ? "opacity-40 cursor-not-allowed bg-bg-elevated border border-[var(--border)]"
                        : isOn
                          ? "bg-lime/30 cursor-pointer"
                          : "bg-bg-elevated border border-[var(--border)] cursor-pointer"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
                        isOn
                          ? "translate-x-4 bg-lime"
                          : "translate-x-0 bg-text-tertiary"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Saving indicator */}
          <div className="h-4 mt-2">
            {dmSaving && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary">
                saving...
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
