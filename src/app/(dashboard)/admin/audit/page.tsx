"use client";

import { useEffect, useState, useCallback } from "react";
import Dropdown from "@/components/Dropdown";

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  timestamp: string;
}

function actionColor(action: string) {
  if (action.includes("APPROVE")) return "bg-mint/10 text-mint";
  if (action.includes("REJECT")) return "bg-coral/10 text-coral";
  if (action.includes("CREATE")) return "bg-lime/10 text-lime";
  if (action.includes("DELETE")) return "bg-coral/10 text-coral";
  if (action.includes("UPDATE")) return "bg-amber/10 text-amber";
  return "bg-violet/10 text-violet";
}

function JsonDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  if (!before && !after) {
    return <p className="text-text-tertiary text-xs">No change data recorded.</p>;
  }

  const allKeys = [
    ...new Set([
      ...Object.keys(before || {}),
      ...Object.keys(after || {}),
    ]),
  ];

  return (
    <div className="grid grid-cols-2 gap-4 text-xs font-mono">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
          Before
        </div>
        {before ? (
          <div className="space-y-1">
            {allKeys.map((key) => {
              const val = before[key];
              const changed = JSON.stringify(val) !== JSON.stringify(after?.[key]);
              return (
                <div key={key} className={changed ? "text-coral" : "text-text-tertiary"}>
                  <span className="text-text-secondary">{key}:</span>{" "}
                  {val === undefined ? <span className="italic">--</span> : JSON.stringify(val)}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-tertiary italic">N/A</p>
        )}
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-2">
          After
        </div>
        {after ? (
          <div className="space-y-1">
            {allKeys.map((key) => {
              const val = after[key];
              const changed = JSON.stringify(val) !== JSON.stringify(before?.[key]);
              return (
                <div key={key} className={changed ? "text-mint" : "text-text-tertiary"}>
                  <span className="text-text-secondary">{key}:</span>{" "}
                  {val === undefined ? <span className="italic">--</span> : JSON.stringify(val)}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-tertiary italic">N/A</p>
        )}
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams();
      if (filterAction) params.set("action", filterAction);
      if (filterEntity) params.set("entityType", filterEntity);
      if (filterUser) params.set("userId", filterUser);
      if (filterFrom) params.set("from", new Date(filterFrom).toISOString());
      if (filterTo) {
        // Set to end of selected day
        const toDate = new Date(filterTo);
        toDate.setHours(23, 59, 59, 999);
        params.set("to", toDate.toISOString());
      }
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = await res.json();
      return data;
    },
    [filterAction, filterEntity, filterUser, filterFrom, filterTo],
  );

  // Initial load and filter changes
  useEffect(() => {
    setLoading(true);
    setLogs([]);
    setNextCursor(null);
    fetchLogs().then((data) => {
      setLogs(data.logs || []);
      setNextCursor(data.nextCursor || null);
      setUserMap((prev) => ({ ...prev, ...(data.userMap || {}) }));
      if (data.actions) setActions(data.actions);
      if (data.entityTypes) setEntityTypes(data.entityTypes);
      if (data.users) setUsers(data.users);
      setLoading(false);
    });
  }, [fetchLogs]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const data = await fetchLogs(nextCursor);
    setLogs((prev) => [...prev, ...(data.logs || [])]);
    setNextCursor(data.nextCursor || null);
    setUserMap((prev) => ({ ...prev, ...(data.userMap || {}) }));
    setLoadingMore(false);
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="skeleton h-10 w-full mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-6">
        Audit <span className="font-display text-lime">Log</span>
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
            Action
          </label>
          <Dropdown
            value={filterAction}
            options={[
              { value: "", label: "All actions" },
              ...actions.map((a) => ({ value: a, label: a })),
            ]}
            onChange={setFilterAction}
            placeholder="All actions"
            size="sm"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
            Entity
          </label>
          <Dropdown
            value={filterEntity}
            options={[
              { value: "", label: "All entities" },
              ...entityTypes.map((e) => ({ value: e, label: e })),
            ]}
            onChange={setFilterEntity}
            placeholder="All entities"
            size="sm"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
            User
          </label>
          <Dropdown
            value={filterUser}
            options={[
              { value: "", label: "All users" },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
            onChange={setFilterUser}
            placeholder="All users"
            size="sm"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
            From
          </label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
            style={{ colorScheme: "dark" }}
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">
            To
          </label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-active)]"
            style={{ colorScheme: "dark" }}
          />
        </div>
        {(filterAction || filterEntity || filterUser || filterFrom || filterTo) && (
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterAction("");
                setFilterEntity("");
                setFilterUser("");
                setFilterFrom("");
                setFilterTo("");
              }}
              className="text-xs text-text-tertiary hover:text-text-secondary transition-colors px-3 py-2"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No activity logged yet.</p>
          <p className="text-text-tertiary text-sm">
            Actions like approving or rejecting transactions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const expanded = expandedId === log.id;
            return (
              <div key={log.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : log.id)}
                  className="card px-4 py-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between w-full text-left hover:border-[var(--lime)]/20 transition-colors"
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded shrink-0 ${actionColor(log.action)}`}
                    >
                      {log.action}
                    </span>
                    <span className="text-sm text-text-secondary truncate">
                      {log.entityType}
                    </span>
                    <span className="text-text-tertiary text-xs font-mono shrink-0">
                      {log.entityId.substring(0, 8)}
                    </span>
                    {/* Chevron sits at the end of the first line on mobile */}
                    <span className="text-text-tertiary text-xs ml-auto shrink-0 sm:hidden">
                      {expanded ? "▲" : "▼"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4 text-xs w-full justify-between sm:w-auto sm:justify-end shrink-0 sm:pl-4">
                    <span className="text-text-secondary truncate">
                      {userMap[log.userId] || log.userId.substring(0, 8)}
                    </span>
                    <span className="text-text-tertiary whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                    <span className="text-text-tertiary shrink-0 hidden sm:inline">
                      {expanded ? "▲" : "▼"}
                    </span>
                  </div>
                </button>
                {expanded && (
                  <div className="card px-5 py-4 mt-px border-t-0 rounded-t-none">
                    <JsonDiff before={log.before} after={log.after} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
