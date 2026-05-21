"use client";

import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Data — derived from plan.md feature tables                        */
/* ------------------------------------------------------------------ */

type Status = "done" | "partial" | "todo";

interface Feature {
  id: string;
  title: string;
  details: string;
  status: Status;
  portal: string;   // ADMIN | DONOR | DEV | BOT | INFRA
  phase: number;
}

const FEATURES: Feature[] = [
  // ── Admin Portal ──
  { id: "a1",  title: "Finance logging",           details: "Manual entry with amount, from, method, screenshot proof, date/time, notes. Edit/delete with audit trail",              status: "done",    portal: "ADMIN", phase: 1 },
  { id: "a2",  title: "Balance dashboard",          details: "Burn rate, runway months, donation trends chart, cost breakdown by category",                                          status: "done",    portal: "ADMIN", phase: 1 },
  { id: "a3",  title: "Subscription manager",       details: "Track ongoing costs with platform, price, frequency, specs. Expiry alerts at 7/3/1 days with color-coded badges",      status: "done",    portal: "ADMIN", phase: 2 },
  { id: "a4",  title: "Services registry",          details: "Categories with custom columns and entries that admins define",                                                         status: "done",    portal: "ADMIN", phase: 2 },
  { id: "a5",  title: "User & role management",     details: "Create accounts, assign multi-role, deactivate. No self-signup",                                                       status: "done",    portal: "ADMIN", phase: 1 },
  { id: "a6",  title: "Donor approval workflow",    details: "Pending/approved/rejected with reason. Notification to donor on status change",                                         status: "done",    portal: "ADMIN", phase: 1 },
  { id: "a7",  title: "Reminders",                  details: "Set frequency + message for recurring tasks. Bot notification + in-app delivery",                                       status: "done",    portal: "ADMIN", phase: 2 },
  { id: "a8",  title: "Top donors leaderboard",     details: "Admin-only view ranked by total contribution with period filters (all-time, year, month)",                              status: "done",    portal: "ADMIN", phase: 3 },
  { id: "a9",  title: "Audit log",                  details: "Immutable record of every write action: who, what, when, before/after values",                                          status: "done",    portal: "ADMIN", phase: 1 },
  { id: "a10", title: "Multi-currency",             details: "BMC comes in USD, local in INR. Auto-fetch exchange rate at transaction time. Toggle view",                              status: "done",    portal: "ADMIN", phase: 2 },
  { id: "a11", title: "Export CSV/Excel",            details: "Export transactions, monthly auto-generated financial summary PDF",                                                     status: "done",    portal: "ADMIN", phase: 2 },

  // ── Donor Portal ──
  { id: "d1",  title: "Donation history",           details: "Full log of contributions with status (pending/approved/rejected)",                                                     status: "done",    portal: "DONOR", phase: 1 },
  { id: "d2",  title: "Submit payment",             details: "Upload proof, enter amount/method, goes to admin approval queue",                                                       status: "done",    portal: "DONOR", phase: 1 },
  { id: "d3",  title: "BMC integration",            details: "One-time + recurring via Buy Me a Coffee. API sync auto-logs donations",                                                status: "done",    portal: "DONOR", phase: 2 },
  { id: "d5",  title: "Donor profile",              details: "Basic info, notification preferences, theme color picker",                                                               status: "done",    portal: "DONOR", phase: 1 },

  // ── Dev Portal ──
  { id: "e1",  title: "Kanban board",               details: "5 status columns, drag-and-drop cards, assignee, priority, deadline, notes",                                            status: "done",    portal: "DEV",   phase: 1 },
  { id: "e2",  title: "Gantt chart",                details: "Visual timeline derived from kanban dates. Color-coded by status and priority",                                           status: "done",    portal: "DEV",   phase: 3 },
  { id: "e3",  title: "Git integration",            details: "Link GitHub repos per project. Show commits, PRs, branch status. Webhook-driven",                                       status: "todo",    portal: "DEV",   phase: 3 },
  { id: "e4",  title: "Admin-assigned todos",       details: "Admins create tasks, assign to devs, set deadlines. Devs see filtered list",                                            status: "done",    portal: "DEV",   phase: 1 },
  { id: "e5",  title: "Dev credentials",            details: "Propose/approve workflow for credential access",                                                                         status: "done",    portal: "DEV",   phase: 1 },
  { id: "e6",  title: "VPS stats",                  details: "CPU, RAM, disk, bandwidth usage with color-coded bars. Beszel agent integration ready",                                  status: "done",    portal: "DEV",   phase: 4 },

  // ── Bot ──
  { id: "b1",  title: "/start + webapp button",     details: "Welcome message with Open PzP Finance webapp button",                                                                   status: "done",    portal: "BOT",   phase: 1 },
  { id: "b2",  title: "/start myid deep link",      details: "Returns user's Telegram ID in copyable format",                                                                         status: "done",    portal: "BOT",   phase: 1 },
  { id: "b3",  title: "OTP delivery",               details: "Sends login code when user authenticates on webapp",                                                                     status: "done",    portal: "BOT",   phase: 1 },
  { id: "b4",  title: "Notifications",              details: "Reminders, approval status changes, expiry alerts, new task assignments",                                                status: "done",    portal: "BOT",   phase: 1 },
  { id: "b5",  title: "File relay",                 details: "Receives screenshots via webapp, stores to TG group, returns file reference",                                            status: "done",    portal: "BOT",   phase: 1 },

  // ── Infra / Cross-cutting ──
  { id: "i1",  title: "GitHub immutable logs",      details: "Separate repo with JSONL files, each commit = log entry. Full audit trail",                                              status: "done",    portal: "INFRA", phase: 1 },
  { id: "i2",  title: "TG upload failure handling",  details: "Wrap sendPhoto in try/catch. Don't save transaction without valid proof",                                               status: "done",    portal: "INFRA", phase: 1 },
  { id: "i3",  title: "Notification fallback",      details: "If bot DM fails, fall back to in-app notification. Log delivery failure",                                                status: "done",    portal: "INFRA", phase: 1 },
  { id: "i4",  title: "BMC webhook dedup",          details: "Store BMC event ID, check before insert. Idempotency pattern",                                                          status: "done",    portal: "INFRA", phase: 2 },
  { id: "i5",  title: "RBAC enforcement",          details: "Strict role checks on all 29 API routes. DEV blocked from finance, DONOR restricted to own data",                       status: "done",    portal: "INFRA", phase: 2 },
];

const COLUMNS: { key: Status; label: string; color: string }[] = [
  { key: "todo",    label: "To Do",        color: "var(--text-tertiary)" },
  { key: "partial", label: "In Progress",  color: "var(--amber)" },
  { key: "done",    label: "Done",         color: "var(--mint)" },
];

const PORTALS = ["ALL", "ADMIN", "DONOR", "DEV", "BOT", "INFRA"] as const;
const PHASES  = [0, 1, 2, 3, 4] as const; // 0 = all

const PORTAL_COLORS: Record<string, string> = {
  ADMIN: "var(--violet)",
  DONOR: "var(--amber)",
  DEV:   "var(--cyan)",
  BOT:   "var(--mint)",
  INFRA: "var(--rose)",
};

const PORTAL_DIM: Record<string, string> = {
  ADMIN: "var(--violet-dim)",
  DONOR: "var(--amber-dim)",
  DEV:   "var(--cyan-dim)",
  BOT:   "var(--mint-dim)",
  INFRA: "var(--rose-dim)",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PlanBoard() {
  const [portal, setPortal] = useState<string>("ALL");
  const [phase, setPhase] = useState<number>(0);

  const filtered = FEATURES.filter((f) => {
    if (portal !== "ALL" && f.portal !== portal) return false;
    if (phase !== 0 && f.phase !== phase) return false;
    return true;
  });

  const totalCount = filtered.length;
  const doneCount  = filtered.filter((f) => f.status === "done").length;
  const partCount  = filtered.filter((f) => f.status === "partial").length;
  const todoCount  = filtered.filter((f) => f.status === "todo").length;
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-void)", color: "var(--text-primary)" }}>
      {/* ── Header ── */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "20px 28px",
          background: "rgba(17,17,22,0.6)",
          backdropFilter: "blur(40px) saturate(1.5)",
          WebkitBackdropFilter: "blur(40px) saturate(1.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Sentinel Roadmap
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
              {doneCount} of {totalCount} features complete ({pct}%)
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ width: 200, height: 6, borderRadius: 3, background: "var(--bg-elevated)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                borderRadius: 3,
                background: "var(--mint)",
                width: `${pct}%`,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {/* Portal filter */}
          {PORTALS.map((p) => {
            const active = portal === p;
            return (
              <button
                key={p}
                onClick={() => setPortal(p)}
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: active ? "1px solid var(--border-hover)" : "1px solid var(--border)",
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                }}
              >
                {p === "ALL" ? "All" : p}
              </button>
            );
          })}

          <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px", alignSelf: "center" }} />

          {/* Phase filter */}
          {PHASES.map((ph) => {
            const active = phase === ph;
            return (
              <button
                key={ph}
                onClick={() => setPhase(ph)}
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: active ? "1px solid var(--border-hover)" : "1px solid var(--border)",
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                }}
              >
                {ph === 0 ? "All Phases" : `Phase ${ph}`}
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Kanban columns ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          padding: "24px 28px",
          minHeight: "calc(100vh - 140px)",
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => {
          const items = filtered.filter((f) => f.status === col.key);
          return (
            <div key={col.key}>
              {/* Column header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                  padding: "0 2px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: col.color,
                    opacity: 0.7,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "var(--text-secondary)",
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    marginLeft: "auto",
                  }}
                >
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "14px 16px",
                      transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-hover)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "var(--shadow-md)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* Portal badge + phase */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: 9,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: PORTAL_DIM[item.portal],
                          color: PORTAL_COLORS[item.portal],
                        }}
                      >
                        {item.portal}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: 9,
                          color: "var(--text-tertiary)",
                          marginLeft: "auto",
                        }}
                      >
                        P{item.phase}
                      </span>
                    </div>

                    {/* Title */}
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
                      {item.title}
                    </div>

                    {/* Details */}
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                      {item.details}
                    </div>
                  </div>
                ))}

                {items.length === 0 && (
                  <div
                    style={{
                      border: "1px dashed var(--border)",
                      borderRadius: 10,
                      padding: "32px 16px",
                      textAlign: "center",
                      color: "var(--text-tertiary)",
                      fontSize: 12,
                    }}
                  >
                    No items
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
