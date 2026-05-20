"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit")
      .then((r) => r.json())
      .then((data) => setLogs(data.logs || []))
      .finally(() => setLoading(false));
  }, []);

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

      {logs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No activity logged yet.</p>
          <p className="text-text-tertiary text-sm">Actions like approving or rejecting transactions will appear here.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="card px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded ${
                  log.action.includes("APPROVE") ? "bg-mint/10 text-mint"
                    : log.action.includes("REJECT") ? "bg-coral/10 text-coral"
                    : log.action.includes("CREATE") ? "bg-lime/10 text-lime"
                    : "bg-violet/10 text-violet"
                }`}>
                  {log.action}
                </span>
                <span className="text-sm text-text-secondary">
                  {log.entityType}
                </span>
                <span className="text-text-tertiary text-xs font-mono">
                  {log.entityId.substring(0, 8)}
                </span>
              </div>
              <span className="text-text-tertiary text-xs">
                {new Date(log.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
