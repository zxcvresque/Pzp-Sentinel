"use client";

import { useEffect, useState } from "react";

interface Repo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  language: string | null;
  updatedAt: string;
}

interface TrackedRepo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  createdAt: string;
}

export default function AdminReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tracked, setTracked] = useState<TrackedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/github/repos").then((r) => r.json()),
      fetch("/api/tracked-repos").then((r) => r.json()),
    ])
      .then(([repoData, trackedData]) => {
        setRepos(repoData.repos || []);
        setTracked(trackedData.tracked || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const trackedSet = new Set(tracked.map((t) => t.fullName));

  async function toggle(repo: Repo) {
    const isTracked = trackedSet.has(repo.fullName);
    setToggling((prev) => new Set(prev).add(repo.fullName));

    if (isTracked) {
      const res = await fetch("/api/tracked-repos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: repo.fullName }),
      });
      if (res.ok) {
        setTracked((prev) => prev.filter((t) => t.fullName !== repo.fullName));
      }
    } else {
      const res = await fetch("/api/tracked-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repo.name,
          fullName: repo.fullName,
          url: repo.url,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTracked((prev) => [data.repo, ...prev]);
      }
    }

    setToggling((prev) => {
      const next = new Set(prev);
      next.delete(repo.fullName);
      return next;
    });
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold">
          Tracked <span className="font-display text-lime">Repos</span>
        </h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          {tracked.length} of {repos.length} tracked
        </span>
      </div>

      {repos.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repos..."
            className="w-full sm:w-72 bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-lime/30"
          />
        </div>
      )}

      {repos.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No repos found.</p>
          <p className="text-text-tertiary text-sm">
            Set <code className="font-mono text-[11px] bg-bg-deep px-1.5 py-0.5 rounded">GITHUB_ORG</code> and{" "}
            <code className="font-mono text-[11px] bg-bg-deep px-1.5 py-0.5 rounded">GITHUB_TOKEN</code> in your .env
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {repos.filter((r) => {
            if (!search.trim()) return true;
            const q = search.toLowerCase();
            return r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) || r.language?.toLowerCase().includes(q);
          }).map((repo) => {
            const isTracked = trackedSet.has(repo.fullName);
            const busy = toggling.has(repo.fullName);
            return (
              <div
                key={repo.fullName}
                className={`card p-4 flex items-center gap-4 transition-colors ${
                  isTracked ? "border-l-2 border-l-lime" : ""
                }`}
              >
                <button
                  onClick={() => toggle(repo)}
                  disabled={busy}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                    isTracked
                      ? "bg-lime/20 text-lime"
                      : "bg-bg-deep text-text-tertiary hover:text-text-secondary"
                  } ${busy ? "opacity-40" : ""}`}
                >
                  {busy ? (
                    <span className="animate-pulse">...</span>
                  ) : isTracked ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8.5l3.5 3.5 6.5-8" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="8" cy="8" r="5.5" />
                    </svg>
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold truncate">{repo.name}</span>
                    {repo.private && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-amber/10 text-amber shrink-0">
                        Private
                      </span>
                    )}
                    {repo.language && (
                      <span className="font-mono text-[10px] text-text-tertiary shrink-0">
                        {repo.language}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-text-tertiary truncate">{repo.description}</p>
                  )}
                </div>

                <a
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-tertiary hover:text-text-secondary transition-colors shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
