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
  status: string;
  accessLevel: "PUBLIC_KEY" | "FULL" | null;
  granted: boolean;
  devPublicKey: string | null;
  vpsServer?: { id: string; name: string } | null;
  credKind?: string | null;
  createdBy: UserRef;
}

interface PendingGrant {
  id: string;
  platform: string;
  label: string;
  accessLevel: "PUBLIC_KEY" | "FULL" | null;
  granted: boolean;
  devPublicKey: string | null;
  vpsServer?: { id: string; name: string } | null;
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
  const [pendingGrants, setPendingGrants] = useState<PendingGrant[]>([]);
  const [pending, setPending] = useState<PendingCred[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [revealError, setRevealError] = useState<Record<string, string>>({});
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
        setPendingGrants(data.pendingGrants || []);
        setPending(data.pending || []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Reveal goes through the audited chokepoint endpoint — the value is never
  // shipped in the list response.
  async function toggleReveal(id: string) {
    if (revealedValues[id] !== undefined) {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealError((prev) => ({ ...prev, [id]: "" }));
    const res = await fetch(`/api/credentials/${id}/reveal`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setRevealedValues((prev) => ({ ...prev, [id]: data.value }));
    } else {
      const d = await res.json().catch(() => ({}));
      setRevealError((prev) => ({ ...prev, [id]: d.error || "Cannot reveal" }));
    }
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
      setPendingGrants(fresh.pendingGrants || []);
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
          {showForm ? "Cancel" : "Share New"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6">
          <div className="text-xs text-amber mb-4">
            {editingParentId
              ? "Proposing an updated value. Admin will review before replacing the current one."
              : "Sharing a credential you own with the team. Admin will review before it goes live."}
          </div>
          <FormExample lines={["Platform: Hetzner VPS", "Label: Root Password, API Key, etc.", "Value: the actual secret"]} />
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
            {submitting ? "Submitting..." : "Submit for Review"}
          </button>
        </form>
      )}

      {pendingGrants.length > 0 && (
        <div className="mb-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            Awaiting Admin Grant ({pendingGrants.length})
          </h2>
          <div className="space-y-2">
            {pendingGrants.map((p) => (
              <div key={p.id} className="card p-4 border-l-2 border-l-amber">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{p.platform}</span>
                    <span className="text-text-tertiary mx-2">/</span>
                    <span className="text-sm text-text-secondary">{p.label}</span>
                    {p.vpsServer && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-violet/10 text-violet ml-2">
                        🔗 {p.vpsServer.name}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-amber/10 text-amber">
                    {p.accessLevel === "PUBLIC_KEY" ? "Key install pending" : "Awaiting grant"}
                  </span>
                </div>
                {p.devPublicKey && (
                  <code className="mt-2 block break-all rounded bg-bg-deep px-2 py-1.5 font-mono text-[11px] text-text-secondary">
                    {p.devPublicKey}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>
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
          <p className="text-text-secondary mb-2">No credentials shared with you yet.</p>
          <p className="text-text-tertiary text-sm">
            Request access from the VPS page, or an admin will share credentials when you need them.
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
                {creds.map((cred) => {
                  const isFull = cred.accessLevel === "FULL";
                  const canPropose = isFull && !cred.vpsServer;
                  return (
                    <div key={cred.id} className="card p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-sm font-semibold">{cred.label}</span>
                            {cred.vpsServer && (
                              <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-violet/10 text-violet">
                                🔗 VPS: {cred.vpsServer.name}
                              </span>
                            )}
                            <span
                              className="font-mono text-[9px] uppercase tracking-[0.08em] px-2 py-0.5 rounded"
                              style={{
                                color: isFull ? "var(--coral)" : "var(--mint)",
                                background: isFull ? "rgba(248,113,113,0.1)" : "rgba(52,211,153,0.1)",
                              }}
                            >
                              {isFull ? "Full access" : "Public-key access"}
                            </span>
                          </div>

                          {isFull ? (
                            <div className="flex items-center gap-2 mb-3 flex-wrap">
                              <button
                                onClick={() => toggleReveal(cred.id)}
                                className="font-mono text-xs px-3 py-1.5 rounded-lg bg-bg-deep border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                              >
                                {revealedValues[cred.id] !== undefined ? "Hide" : "Reveal"}
                              </button>
                              {revealedValues[cred.id] !== undefined && (
                                <code className="font-mono text-sm text-lime bg-bg-deep px-3 py-1.5 rounded-lg border border-[var(--border)] break-all">
                                  {revealedValues[cred.id]}
                                </code>
                              )}
                              {revealError[cred.id] && (
                                <span className="text-xs text-coral">{revealError[cred.id]}</span>
                              )}
                            </div>
                          ) : (
                            <div className="mb-3">
                              <p className="text-[11px] text-text-tertiary leading-relaxed mb-1">
                                Your SSH key is installed on this server — use your matching private key to connect. The password / private key is never shared.
                              </p>
                              {cred.devPublicKey && (
                                <code className="block break-all rounded bg-bg-deep px-2 py-1.5 font-mono text-[11px] text-text-secondary border border-[var(--border)]">
                                  {cred.devPublicKey}
                                </code>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-2 flex-wrap text-xs text-text-tertiary">
                            <span className="flex items-center gap-1">
                              Added by{" "}
                              <TgUser name={cred.createdBy.name} telegramUser={cred.createdBy.telegramUser} photoUrl={cred.createdBy.photoUrl} size={18} />
                            </span>
                          </div>
                        </div>
                        {canPropose && (
                          <button
                            onClick={() => startPropose(cred)}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet/10 text-violet hover:bg-violet/20 transition-colors shrink-0"
                          >
                            Propose Update
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
