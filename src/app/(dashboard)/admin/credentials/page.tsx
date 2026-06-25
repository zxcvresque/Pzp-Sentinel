"use client";

import { useEffect, useState } from "react";
import TgUser from "@/components/TgUser";
import FormExample from "@/components/FormExample";
import PageTour from "@/components/PageTour";

type AccessLevel = "PUBLIC_KEY" | "FULL";

interface UserRef {
  id: string;
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
}

interface AccessRow {
  userId: string;
  accessLevel: AccessLevel;
  granted: boolean;
  grantedAt: string | null;
  devPublicKey: string | null;
  user: UserRef;
}

interface Revision {
  id: string;
  platform: string;
  label: string;
  value: string;
  status: string;
  createdBy: UserRef;
  createdAt: string;
}

interface Credential {
  id: string;
  platform: string;
  label: string;
  value: string;
  status: string;
  accesses: AccessRow[];
  createdBy: UserRef;
  vpsServer?: { id: string; name: string } | null;
  credKind?: string | null;
  revisions: Revision[];
  createdAt: string;
}

interface DevUser {
  id: string;
  name: string;
}

function installCommand(key: string): string {
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${JSON.stringify(key)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

/* ------------------------------------------------------------------ */
/*  Per-dev access row (in a credential card)                          */
/* ------------------------------------------------------------------ */

function AccessRowItem({ row, onToggleGrant }: { row: AccessRow; onToggleGrant: () => void }) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const isFull = row.accessLevel === "FULL";

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-bg-deep border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TgUser name={row.user.name} telegramUser={row.user.telegramUser} photoUrl={row.user.photoUrl} size={18} />
        <span
          className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
          style={{
            color: isFull ? "var(--coral)" : "var(--mint)",
            background: isFull ? "rgba(248,113,113,0.1)" : "rgba(52,211,153,0.1)",
          }}
        >
          {isFull ? "Full" : "Public-key"}
        </span>
        <span
          className="font-mono text-[9px] uppercase tracking-[0.08em]"
          style={{ color: row.granted ? "var(--mint)" : "var(--amber)" }}
        >
          {row.granted ? "granted ✓" : "awaiting grant"}
        </span>
        <button
          onClick={onToggleGrant}
          className="ml-auto font-mono text-[10px] uppercase px-2 py-1 rounded bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
        >
          {row.granted ? "Revoke" : "Grant"}
        </button>
        {row.devPublicKey && (
          <button
            onClick={() => setShowKey((v) => !v)}
            className="font-mono text-[10px] uppercase px-2 py-1 rounded bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
          >
            {showKey ? "Hide key" : "Show key"}
          </button>
        )}
      </div>

      {showKey && row.devPublicKey && (
        <div className="space-y-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary block">
            Submitted public key
          </span>
          <code className="block break-all rounded bg-bg-card px-2 py-1.5 font-mono text-[11px] text-text-secondary">
            {row.devPublicKey}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(installCommand(row.devPublicKey!));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="font-mono text-[10px] uppercase px-2 py-1 rounded bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
            style={{ color: copied ? "var(--mint)" : undefined }}
          >
            {copied ? "Copied install command" : "Copy install command"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [devs, setDevs] = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const [platform, setPlatform] = useState("");
  const [fields, setFields] = useState<{ label: string; value: string }[]>([{ label: "", value: "" }]);
  const [accessMap, setAccessMap] = useState<Record<string, AccessLevel>>({});
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    const fresh = await fetch("/api/credentials").then((r) => r.json());
    setCredentials(fresh.credentials || []);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/credentials").then((r) => (r.ok ? r.json() : { credentials: [] })),
      fetch("/api/users").then((r) => (r.ok ? r.json() : { users: [] })),
    ]).then(([credData, userData]) => {
      setCredentials(credData.credentials || []);
      const allUsers = userData.users || [];
      setDevs(allUsers.filter((u: { roles: string[] }) => u.roles.includes("DEV")));
      setLoading(false);
    });
  }, []);

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEdit(cred: Credential) {
    setEditId(cred.id);
    setPlatform(cred.platform);
    setFields([{ label: cred.label, value: cred.value }]);
    setAccessMap(Object.fromEntries(cred.accesses.map((a) => [a.userId, a.accessLevel])));
    setShowForm(true);
  }

  function resetForm() {
    setEditId(null);
    setPlatform("");
    setFields([{ label: "", value: "" }]);
    setAccessMap({});
    setShowForm(false);
  }

  function updateField(index: number, key: "label" | "value", val: string) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: val } : f)));
  }

  function addField() {
    setFields((prev) => [...prev, { label: "", value: "" }]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function setDevAccess(id: string, level: AccessLevel | null) {
    setAccessMap((prev) => {
      const next = { ...prev };
      if (!level) delete next[id];
      else next[id] = level;
      return next;
    });
  }

  function accessesPayload() {
    return Object.entries(accessMap).map(([userId, accessLevel]) => ({ userId, accessLevel }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const validFields = fields.filter((f) => f.label && f.value);
    const accesses = accessesPayload();

    if (editId) {
      const body = { platform, label: validFields[0]?.label, value: validFields[0]?.value, accesses };
      await fetch(`/api/credentials/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      for (const field of validFields) {
        const body = { platform, label: field.label, value: field.value, accesses };
        await fetch("/api/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
    }

    await refresh();
    resetForm();
    setSubmitting(false);
  }

  async function handleToggleGrant(cred: Credential, userId: string) {
    const accesses = cred.accesses.map((a) => ({
      userId: a.userId,
      accessLevel: a.accessLevel,
      granted: a.userId === userId ? !a.granted : a.granted,
    }));
    const res = await fetch(`/api/credentials/${cred.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accesses }),
    });
    if (res.ok) await refresh();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    }
  }

  async function handleReview(revisionId: string, action: "approve" | "reject", credId: string) {
    const res = await fetch(`/api/credentials/${revisionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      await refresh();
      if (action === "approve") {
        setRevealed((prev) => {
          const next = new Set(prev);
          next.add(credId);
          return next;
        });
      }
    }
  }

  const grouped = credentials.reduce<Record<string, Credential[]>>((acc, c) => {
    (acc[c.platform] ??= []).push(c);
    return acc;
  }, {});

  const pendingCount = credentials.reduce((sum, c) => sum + c.revisions.length, 0);

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
          Credential <span className="font-display text-lime">Vault</span>
        </h1>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full bg-amber/10 text-amber">
              {pendingCount} pending
            </span>
          )}
          <button
            data-tour="add-credential"
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
          >
            {showForm ? "Cancel" : "Add Credential"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <FormExample lines={["Platform: AWS Console", "Fields: Username → admin@pzp.dev, Password → ••••••"]} />
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Platform
            </label>
            <input
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="e.g. Hetzner, Cloudflare"
              required
              className="w-full sm:w-1/3 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
            />
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Credentials
              </label>
              {!editId && (
                <button
                  type="button"
                  onClick={addField}
                  className="text-xs text-lime hover:text-lime/80 transition-colors"
                >
                  + Add another
                </button>
              )}
            </div>
            <div className="space-y-3">
              {fields.map((field, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(i, "label", e.target.value)}
                      placeholder="Label (e.g. API Key, Root Password)"
                      required
                      className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary text-sm focus:outline-none focus:border-lime/30"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={field.value}
                      onChange={(e) => updateField(i, "value", e.target.value)}
                      placeholder="Value"
                      required
                      className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:border-lime/30"
                    />
                  </div>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeField(i)}
                      className="text-text-tertiary hover:text-coral text-sm mt-3 transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Share with Developers
            </label>
            <p className="text-[11px] text-text-tertiary mb-3 leading-relaxed">
              Pick an access level per developer.{" "}
              <span className="text-mint">Public-key</span>: the dev submits their own SSH key, you install it — they never see the secret.{" "}
              <span className="text-coral">Full</span>: the dev can reveal the actual value.
            </p>
            <div className="space-y-2">
              {devs.map((dev) => {
                const lvl = accessMap[dev.id];
                const options: [AccessLevel | null, string][] = [
                  [null, "—"],
                  ["PUBLIC_KEY", "Public-key"],
                  ["FULL", "Full"],
                ];
                return (
                  <div key={dev.id} className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-text-secondary min-w-[120px]">{dev.name}</span>
                    <div className="flex gap-1">
                      {options.map(([val, label]) => {
                        const active = (val === null && !lvl) || val === lvl;
                        const activeBg =
                          val === "FULL"
                            ? "bg-coral text-bg-void border-coral"
                            : val === "PUBLIC_KEY"
                              ? "bg-mint text-bg-void border-mint"
                              : "bg-bg-deep text-text-secondary border-[var(--border)]";
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setDevAccess(dev.id, val)}
                            className={`font-mono text-[10px] uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors ${
                              active ? activeBg : "text-text-secondary border-[var(--border)] hover:border-[var(--border-hover)]"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {devs.length === 0 && (
                <span className="text-text-tertiary text-xs">No developers found</span>
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !platform || !fields.some((f) => f.label && f.value)}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Saving..." : editId ? "Update Credential" : "Save Credentials"}
          </button>
        </form>
      )}

      {credentials.length === 0 ? (
        <div data-tour="credential-list" className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No credentials stored yet.</p>
          <p className="text-text-tertiary text-sm">
            Add platform credentials and assign access to developers.
          </p>
        </div>
      ) : (
        <div data-tour="credential-list" className="space-y-8">
          {Object.entries(grouped).map(([platformName, creds]) => (
            <div key={platformName}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                {platformName}
              </h2>
              <div className="space-y-3">
                {creds.map((cred) => (
                  <div key={cred.id} className="card p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-sm font-semibold">{cred.label}</span>
                          {cred.vpsServer && (
                            <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-violet/10 text-violet">
                              🔗 VPS: {cred.vpsServer.name}
                            </span>
                          )}
                          {cred.revisions.length > 0 && (
                            <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-amber/10 text-amber">
                              {cred.revisions.length} pending update{cred.revisions.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <button
                            onClick={() => toggleReveal(cred.id)}
                            className="font-mono text-xs px-3 py-1.5 rounded-lg bg-bg-deep border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                          >
                            {revealed.has(cred.id) ? "Hide" : "Reveal"}
                          </button>
                          {revealed.has(cred.id) && (
                            <code className="max-w-full font-mono text-sm text-lime bg-bg-deep px-3 py-1.5 rounded-lg border border-[var(--border)] break-all">
                              {cred.value}
                            </code>
                          )}
                        </div>
                        {cred.accesses.length > 0 ? (
                          <div className="space-y-2">
                            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary block">
                              Access
                            </span>
                            {cred.accesses.map((row) => (
                              <AccessRowItem
                                key={row.userId}
                                row={row}
                                onToggleGrant={() => handleToggleGrant(cred, row.userId)}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
                            Not shared
                          </span>
                        )}
                      </div>
                      <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:shrink-0">
                        <button
                          onClick={() => startEdit(cred)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(cred.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {cred.revisions.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-amber">
                          Pending Changes
                        </div>
                        {cred.revisions.map((rev) => (
                          <div
                            key={rev.id}
                            className="bg-bg-deep rounded-lg p-4 border border-amber/20"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="mb-3 flex flex-col gap-1 text-xs text-text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                                  <span className="flex min-w-0 items-center gap-1">
                                    <span className="shrink-0">By</span>
                                    <TgUser name={rev.createdBy.name} telegramUser={rev.createdBy.telegramUser} photoUrl={rev.createdBy.photoUrl} size={18} />
                                  </span>
                                  <span className="font-mono text-[10px] text-text-tertiary">
                                    {new Date(rev.createdAt).toLocaleString(undefined, {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })}
                                  </span>
                                </div>
                                <div className="text-sm mb-1">
                                  <span className="text-text-tertiary">Platform:</span>{" "}
                                  {rev.platform}
                                </div>
                                <div className="text-sm mb-1">
                                  <span className="text-text-tertiary">Label:</span>{" "}
                                  {rev.label}
                                </div>
                                <div className="text-sm">
                                  <span className="text-text-tertiary">Value:</span>{" "}
                                  <code className="font-mono text-lime">{rev.value}</code>
                                </div>
                              </div>
                              <div className="flex w-full justify-end gap-2 sm:w-auto sm:shrink-0">
                                <button
                                  onClick={() => handleReview(rev.id, "approve", cred.id)}
                                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-mint/10 text-mint hover:bg-mint/20 transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReview(rev.id, "reject", cred.id)}
                                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/10 text-coral hover:bg-coral/20 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <PageTour pageKey="admin-credentials" />
    </div>
  );
}
