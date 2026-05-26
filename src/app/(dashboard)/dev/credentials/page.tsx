"use client";

import { useEffect, useState } from "react";
import TgUser from "@/components/TgUser";
import FormExample from "@/components/FormExample";

interface UserRef {
  id: string;
  name: string;
  photoUrl?: string | null;
  telegramUser?: string | null;
}

interface Credential {
  id: string;
  platform: string;
  label: string;
  value: string;
  assignees: UserRef[];
  createdBy: UserRef;
}

interface PendingCred {
  id: string;
  platform: string;
  label: string;
  value: string;
  status: string;
  parent: { id: string; platform: string; label: string } | null;
  createdAt: string;
}

export default function DevCredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [pending, setPending] = useState<PendingCred[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);

  const [platform, setPlatform] = useState("");
  const [fields, setFields] = useState<{ label: string; value: string }[]>([
    { label: "", value: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => r.json())
      .then((data) => {
        setCredentials(data.credentials || []);
        setPending(data.pending || []);
      })
      .finally(() => setLoading(false));
  }, []);

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startPropose(cred: Credential) {
    setEditingParentId(cred.id);
    setPlatform(cred.platform);
    setFields([{ label: cred.label, value: "" }]);
    setShowForm(true);
  }

  function startNew() {
    setEditingParentId(null);
    setPlatform("");
    setFields([{ label: "", value: "" }]);
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingParentId(null);
    setPlatform("");
    setFields([{ label: "", value: "" }]);
  }

  function updateField(idx: number, key: "label" | "value", val: string) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: val } : f)));
  }

  function addField() {
    setFields((prev) => [...prev, { label: "", value: "" }]);
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const validFields = fields.filter((f) => f.label.trim() && f.value.trim());
    let ok = true;
    for (const f of validFields) {
      const body: Record<string, string | null> = {
        platform,
        label: f.label.trim(),
        value: f.value.trim(),
      };
      if (editingParentId) body.parentId = editingParentId;

      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) ok = false;
    }

    if (ok) {
      const fresh = await fetch("/api/credentials").then((r) => r.json());
      setCredentials(fresh.credentials || []);
      setPending(fresh.pending || []);
      resetForm();
    }
    setSubmitting(false);
  }

  const hasValidField = fields.some((f) => f.label.trim() && f.value.trim());

  const grouped = credentials.reduce<Record<string, Credential[]>>((acc, c) => {
    (acc[c.platform] ??= []).push(c);
    return acc;
  }, {});

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
          My <span className="font-display text-lime">Credentials</span>
        </h1>
        <button
          onClick={() => (showForm ? resetForm() : startNew())}
          className="bg-lime text-bg-void font-semibold px-5 py-2.5 rounded-full text-sm hover:bg-lime/90 transition-colors"
        >
          {showForm ? "Cancel" : "Propose New"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="text-xs text-amber mb-4">
            {editingParentId
              ? "Proposing an update. Admin approval required."
              : "Proposing a new credential. Admin approval required."}
          </div>
          <FormExample lines={["Platform: Vercel Dashboard", "Why: Need deployment access for frontend"]} />
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Platform
            </label>
            <input
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="e.g. Hetzner"
              required
              className="w-full sm:w-1/3 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
            />
          </div>
          <div className="space-y-3 mb-4">
            {fields.map((f, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  {idx === 0 && (
                    <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                      Label
                    </label>
                  )}
                  <input
                    type="text"
                    value={f.label}
                    onChange={(e) => updateField(idx, "label", e.target.value)}
                    placeholder="e.g. API Key"
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  />
                </div>
                <div className="flex-1">
                  {idx === 0 && (
                    <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                      Value
                    </label>
                  )}
                  <input
                    type="text"
                    value={f.value}
                    onChange={(e) => updateField(idx, "value", e.target.value)}
                    placeholder="The credential value"
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:border-lime/30"
                  />
                </div>
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeField(idx)}
                    className="px-3 py-3 text-coral hover:text-coral/80 transition-colors text-sm"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addField}
              className="text-xs text-lime hover:text-lime/80 transition-colors font-semibold"
            >
              + Add another
            </button>
          </div>
          <button
            type="submit"
            disabled={submitting || !platform || !hasValidField}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Submitting..." : "Submit for Approval"}
          </button>
        </form>
      )}

      {pending.length > 0 && (
        <div className="mb-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            Your Pending Submissions ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="card p-4 border-l-2 border-l-amber">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{p.platform}</span>
                    <span className="text-text-tertiary mx-2">/</span>
                    <span className="text-sm text-text-secondary">{p.label}</span>
                    {p.parent && (
                      <span className="text-text-tertiary text-xs ml-2">
                        (update to existing)
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-amber/10 text-amber">
                    Awaiting Review
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {credentials.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No credentials assigned to you yet.</p>
          <p className="text-text-tertiary text-sm">
            An admin will assign platform credentials when you need access.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([platformName, creds]) => (
            <div key={platformName}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-3">
                {platformName}
              </h2>
              <div className="space-y-3">
                {creds.map((cred) => (
                  <div key={cred.id} className="card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold mb-2">{cred.label}</div>
                        <div className="flex items-center gap-2 mb-3">
                          <button
                            onClick={() => toggleReveal(cred.id)}
                            className="font-mono text-xs px-3 py-1.5 rounded-lg bg-bg-deep border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                          >
                            {revealed.has(cred.id) ? "Hide" : "Reveal"}
                          </button>
                          {revealed.has(cred.id) && (
                            <code className="font-mono text-sm text-lime bg-bg-deep px-3 py-1.5 rounded-lg border border-[var(--border)] break-all">
                              {cred.value}
                            </code>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-text-tertiary">
                          <span className="flex items-center gap-1">Added by <TgUser name={cred.createdBy.name} telegramUser={cred.createdBy.telegramUser} photoUrl={cred.createdBy.photoUrl} size={18} /></span>
                          {cred.assignees.length > 1 && (
                            <>
                              <span className="opacity-30">|</span>
                              <span>
                                Shared with{" "}
                                {cred.assignees
                                  .map((a) => a.name)
                                  .join(", ")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => startPropose(cred)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors shrink-0"
                      >
                        Propose Update
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
