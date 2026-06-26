"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Dropdown from "@/components/Dropdown";
import PageTour from "@/components/PageTour";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  deadline: string | null;
  createdAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string; photoUrl?: string | null } | null;
  tags: Tag[];
  subtasks: Task[];
}

interface Project {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLOR: Record<string, string> = {
  BACKLOG: "var(--text-tertiary)",
  TODO: "var(--text-tertiary)",
  IN_PROGRESS: "var(--amber)",
  REVIEW: "var(--violet)",
  DONE: "var(--mint)",
};

const STATUS_BG: Record<string, string> = {
  BACKLOG: "rgba(228,228,232,0.06)",
  TODO: "rgba(228,228,232,0.08)",
  IN_PROGRESS: "rgba(251,191,36,0.12)",
  REVIEW: "rgba(167,139,250,0.12)",
  DONE: "rgba(52,211,153,0.12)",
};

const PRIORITY_BORDER: Record<string, string> = {
  LOW: "rgba(228,228,232,0.15)",
  MEDIUM: "var(--amber)",
  HIGH: "var(--coral)",
  CRITICAL: "var(--coral)",
};

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  DONE: "Done",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Tooltip component                                                  */
/* ------------------------------------------------------------------ */

interface TooltipData {
  task: Task;
  x: number;
  y: number;
}

function Tooltip({ data }: { data: TooltipData }) {
  const { task, x, y } = data;

  return (
    <div
      className="fixed z-[100] pointer-events-none animate-scale-in"
      style={{
        left: Math.min(x + 12, window.innerWidth - 280),
        top: Math.max(y - 10, 8),
      }}
    >
      <div
        className="rounded-xl border border-[var(--border)] px-4 py-3 shadow-lg max-w-[260px]"
        style={{ background: "var(--bg-card)" }}
      >
        <div className="text-sm font-medium text-[var(--text-primary)] mb-1.5 leading-snug">
          {task.title}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Status
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
              style={{
                color: STATUS_COLOR[task.status],
                background: STATUS_BG[task.status],
              }}
            >
              {STATUS_LABEL[task.status] || task.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Priority
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              {task.priority}
            </span>
          </div>
          {task.assignee && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Assignee
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {task.assignee.name}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Dates
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {task.startDate
                ? formatDateFull(new Date(task.startDate))
                : "No start"}
              {" - "}
              {task.deadline
                ? formatDateFull(new Date(task.deadline))
                : "No deadline"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile mini-bar (inline timeline visualization)                    */
/* ------------------------------------------------------------------ */

function MobileTimelineBar({
  task,
  timelineStart,
  totalDays,
  todayPct,
}: {
  task: Task;
  timelineStart: Date;
  totalDays: number;
  todayPct: number;
}) {
  const start = task.startDate
    ? startOfDay(new Date(task.startDate))
    : startOfDay(new Date(task.createdAt));
  const end = task.deadline ? startOfDay(new Date(task.deadline)) : null;
  const startPct = Math.max(
    0,
    Math.min(100, (daysBetween(timelineStart, start) / totalDays) * 100),
  );

  if (!end || start.getTime() === end.getTime()) {
    return (
      <div
        className="relative h-1.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
          style={{
            left: `calc(${startPct}% - 4px)`,
            background: STATUS_COLOR[task.status],
          }}
        />
        {todayPct > 0 && todayPct < 100 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 rounded-full"
            style={{ left: `${todayPct}%`, background: "var(--lime)", opacity: 0.7 }}
          />
        )}
      </div>
    );
  }

  const endPct = Math.max(
    0,
    Math.min(100, (daysBetween(timelineStart, end) / totalDays) * 100),
  );
  const widthPct = Math.max(endPct - startPct, 1);

  return (
    <div
      className="relative h-1.5 rounded-full overflow-hidden"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <div
        className="absolute top-0 bottom-0 rounded-full"
        style={{
          left: `${startPct}%`,
          width: `${widthPct}%`,
          background: STATUS_COLOR[task.status],
          opacity: 0.5,
        }}
      />
      {todayPct > 0 && todayPct < 100 && (
        <div
          className="absolute top-0 bottom-0 w-0.5 rounded-full"
          style={{ left: `${todayPct}%`, background: "var(--lime)", opacity: 0.7 }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Gantt page                                                    */
/* ------------------------------------------------------------------ */

export default function GanttPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState("");
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks/mine").then((r) => (r.ok ? r.json() : { tasks: [] })),
      fetch("/api/projects").then((r) =>
        r.ok ? r.json() : { projects: [] }
      ),
    ])
      .then(([taskData, projData]) => {
        setTasks(taskData.tasks || []);
        setProjects(projData.projects || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ── Flatten subtasks into the same timeline ── */
  const allTasks = useMemo(() => {
    const flat: Task[] = [];
    for (const t of tasks) {
      flat.push(t);
      if (t.subtasks) {
        for (const sub of t.subtasks) {
          flat.push({ ...sub, project: t.project });
        }
      }
    }
    return flat;
  }, [tasks]);

  /* ── Filtered tasks ── */
  const filtered = useMemo(
    () =>
      filterProject
        ? allTasks.filter((t) => t.project?.id === filterProject)
        : allTasks,
    [allTasks, filterProject]
  );

  /* ── Compute timeline bounds ── */
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    if (filtered.length === 0)
      return {
        timelineStart: startOfDay(new Date()),
        timelineEnd: addDays(new Date(), 30),
        totalDays: 30,
      };

    let minDate = Infinity;
    let maxDate = -Infinity;

    for (const t of filtered) {
      const start = t.startDate
        ? new Date(t.startDate).getTime()
        : new Date(t.createdAt).getTime();
      const end = t.deadline
        ? new Date(t.deadline).getTime()
        : start;
      // Skip tasks with invalid/missing dates so a single bad row can't break the timeline.
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (start < minDate) minDate = start;
      if (end > maxDate) maxDate = end;
    }

    // If every task was skipped (all dates invalid), fall back to a default window.
    if (!Number.isFinite(minDate) || !Number.isFinite(maxDate)) {
      return {
        timelineStart: startOfDay(new Date()),
        timelineEnd: addDays(new Date(), 30),
        totalDays: 30,
      };
    }

    // Add padding of 3 days on each side
    const s = addDays(startOfDay(new Date(minDate)), -3);
    const e = addDays(startOfDay(new Date(maxDate)), 4);
    const days = Math.max(daysBetween(s, e), 14);

    return { timelineStart: s, timelineEnd: e, totalDays: days };
  }, [filtered]);

  /* ── Group tasks by project ── */
  const groupedByProject = useMemo(() => {
    const groups: Record<string, { name: string; tasks: Task[] }> = {};
    for (const t of filtered) {
      const pid = t.project?.id || "_none";
      const pname = t.project?.name || "No Project";
      if (!groups[pid]) groups[pid] = { name: pname, tasks: [] };
      groups[pid].tasks.push(t);
    }
    // Sort tasks within each group by start date
    for (const g of Object.values(groups)) {
      g.tasks.sort((a, b) => {
        const aStart = a.startDate || a.createdAt;
        const bStart = b.startDate || b.createdAt;
        return new Date(aStart).getTime() - new Date(bStart).getTime();
      });
    }
    return groups;
  }, [filtered]);

  /* ── Generate tick marks ── */
  const ticks = useMemo(() => {
    const result: { date: Date; label: string; pct: number; isMonth: boolean }[] = [];
    // Decide granularity: weekly if < 90 days, else monthly
    const useWeekly = totalDays < 90;
    const cursor = new Date(timelineStart);

    if (useWeekly) {
      // Snap to nearest Monday
      const day = cursor.getDay();
      const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
      cursor.setDate(cursor.getDate() + diff);

      while (cursor <= timelineEnd) {
        const pct = (daysBetween(timelineStart, cursor) / totalDays) * 100;
        const isMonth = cursor.getDate() <= 7;
        result.push({
          date: new Date(cursor),
          label: formatDate(cursor),
          pct,
          isMonth,
        });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else {
      // Monthly ticks
      cursor.setDate(1);
      cursor.setMonth(cursor.getMonth() + 1);
      while (cursor <= timelineEnd) {
        const pct = (daysBetween(timelineStart, cursor) / totalDays) * 100;
        result.push({
          date: new Date(cursor),
          label: cursor.toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
          }),
          pct,
          isMonth: true,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    return result;
  }, [timelineStart, timelineEnd, totalDays]);

  /* ── Today marker position ── */
  const todayPct = useMemo(() => {
    const today = startOfDay(new Date());
    const pct = (daysBetween(timelineStart, today) / totalDays) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [timelineStart, totalDays]);

  /* ── Position calculator for a task bar ── */
  function getBarStyle(task: Task) {
    const start = task.startDate
      ? startOfDay(new Date(task.startDate))
      : startOfDay(new Date(task.createdAt));
    const end = task.deadline
      ? startOfDay(new Date(task.deadline))
      : null;

    const startPct = (daysBetween(timelineStart, start) / totalDays) * 100;

    if (!end || start.getTime() === end.getTime()) {
      // Dot: no end date or same day
      return { left: `${startPct}%`, width: "8px", isDot: true };
    }

    const endPct = (daysBetween(timelineStart, end) / totalDays) * 100;
    const widthPct = Math.max(endPct - startPct, 0.5);

    return {
      left: `${startPct}%`,
      width: `${widthPct}%`,
      isDot: false,
    };
  }

  /* ── Scroll to today on first load ── */
  useEffect(() => {
    if (!loading && scrollRef.current) {
      const container = scrollRef.current;
      const totalWidth = container.scrollWidth;
      const scrollTarget = (todayPct / 100) * totalWidth - container.clientWidth / 3;
      container.scrollLeft = Math.max(0, scrollTarget);
    }
  }, [loading, todayPct]);

  /* ── Detect mobile viewport ── */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const initialCheck = setTimeout(() => setIsMobile(mq.matches), 0);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setExpandedId(null);
    };
    mq.addEventListener("change", handler);
    return () => {
      clearTimeout(initialCheck);
      mq.removeEventListener("change", handler);
    };
  }, []);

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-56 mb-6" />
        <div className="skeleton h-10 w-48 mb-6" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="skeleton h-4 w-32 mb-2" />
              <div className="skeleton h-8 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const projectOptions = [
    { value: "", label: "All Projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const LABEL_COL_WIDTH = 200;
  const TIMELINE_MIN_WIDTH = Math.max(totalDays * 28, 800);

  return (
    <div>
      {/* Header */}
      <div data-tour="gantt-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">
          Gantt <span className="font-display text-lime">Timeline</span>
        </h1>
        <div className="flex items-center gap-3">
          <Dropdown
            value={filterProject}
            options={projectOptions}
            onChange={setFilterProject}
            placeholder="All Projects"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div data-tour="gantt-chart" className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No tasks to display.</p>
          <p className="text-text-tertiary text-sm">
            Tasks with dates assigned to you will appear here as timeline bars.
          </p>
        </div>
      ) : isMobile ? (
        /* ── Mobile list view ── */
        <div className="space-y-3">
          {/* Timeline range indicator */}
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {formatDate(timelineStart)}
            </span>
            <div
              className="flex-1 mx-3 relative"
              style={{ height: 1, background: "var(--border)" }}
            >
              {todayPct > 0 && todayPct < 100 && (
                <div
                  className="absolute -top-1 w-2 h-2 rounded-full"
                  style={{
                    left: `${todayPct}%`,
                    background: "var(--lime)",
                    transform: "translateX(-50%)",
                  }}
                />
              )}
            </div>
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {formatDate(timelineEnd)}
            </span>
          </div>

          {/* Project groups */}
          {Object.entries(groupedByProject).map(
            ([pid, { name, tasks: projectTasks }]) => (
              <div
                key={pid}
                className="rounded-xl border border-[var(--border)] overflow-hidden"
                style={{ background: "var(--bg-card)" }}
              >
                {/* Project header */}
                <div
                  className="px-4 py-2.5 flex items-center gap-2"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-deep)",
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-lime">
                    {name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    {projectTasks.length}
                  </span>
                </div>

                {/* Task cards */}
                {projectTasks.map((task, idx) => {
                  const isExpanded = expandedId === task.id;
                  const startD = task.startDate
                    ? new Date(task.startDate)
                    : null;
                  const endD = task.deadline
                    ? new Date(task.deadline)
                    : null;
                  const isOverdue =
                    endD && endD < new Date() && task.status !== "DONE";
                  const duration =
                    startD && endD ? daysBetween(startD, endD) : null;

                  return (
                    <div
                      key={task.id}
                      style={{
                        borderBottom:
                          idx < projectTasks.length - 1
                            ? "1px solid var(--border)"
                            : undefined,
                      }}
                    >
                      <button
                        className="w-full text-left px-4 py-3 active:bg-white/[0.03] transition-colors"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : task.id)
                        }
                      >
                        {/* Title row */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              background: STATUS_COLOR[task.status],
                            }}
                          />
                          <span className="text-sm text-[var(--text-primary)] truncate flex-1 font-medium">
                            {task.title}
                          </span>
                          <svg
                            className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform shrink-0 ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>

                        {/* Meta tags */}
                        <div className="flex items-center gap-2 mb-2 pl-3.5">
                          <span
                            className="font-mono text-[9px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
                            style={{
                              color: STATUS_COLOR[task.status],
                              background: STATUS_BG[task.status],
                            }}
                          >
                            {STATUS_LABEL[task.status] || task.status}
                          </span>
                          <span
                            className="font-mono text-[9px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded"
                            style={{
                              color: PRIORITY_BORDER[task.priority],
                              background: "rgba(255,255,255,0.04)",
                            }}
                          >
                            {task.priority}
                          </span>
                          {task.assignee && (
                            <span className="text-[11px] text-[var(--text-tertiary)] ml-auto truncate max-w-[80px]">
                              {task.assignee.name}
                            </span>
                          )}
                        </div>

                        {/* Date range */}
                        <div className="flex items-center mb-2 pl-3.5">
                          <span
                            className={`text-[11px] ${
                              isOverdue
                                ? "text-[var(--coral)]"
                                : "text-[var(--text-tertiary)]"
                            }`}
                          >
                            {startD ? formatDate(startD) : "No start"}
                            {" → "}
                            {endD ? formatDate(endD) : "No end"}
                            {duration !== null && (
                              <span className="text-[var(--text-tertiary)] ml-1">
                                · {duration}d
                              </span>
                            )}
                            {isOverdue && (
                              <span className="ml-1.5 text-[var(--coral)] font-medium">
                                overdue
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Mini timeline bar */}
                        <div className="pl-3.5">
                          <MobileTimelineBar
                            task={task}
                            timelineStart={timelineStart}
                            totalDays={totalDays}
                            todayPct={todayPct}
                          />
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div
                          className="px-4 pb-3 space-y-2"
                          style={{
                            paddingLeft: "2rem",
                            borderTop: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.01)",
                          }}
                        >
                          {task.description && (
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-2">
                              {task.description}
                            </p>
                          )}
                          {task.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {task.tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="font-mono text-[9px] px-2 py-0.5 rounded-full"
                                  style={{
                                    background: `${tag.color}20`,
                                    color: tag.color,
                                  }}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div>
                              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] block mb-0.5">
                                Start
                              </span>
                              <span className="text-xs text-[var(--text-secondary)]">
                                {startD ? formatDateFull(startD) : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] block mb-0.5">
                                Deadline
                              </span>
                              <span
                                className={`text-xs ${
                                  isOverdue
                                    ? "text-[var(--coral)]"
                                    : "text-[var(--text-secondary)]"
                                }`}
                              >
                                {endD ? formatDateFull(endD) : "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ),
          )}

          {/* Mobile legend */}
          <div
            className="rounded-xl border border-[var(--border)] px-4 py-3"
            style={{ background: "var(--bg-deep)" }}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: STATUS_COLOR[key] }}
                  />
                  <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                    {label}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-0.5 rounded-full"
                  style={{ background: "var(--lime)", opacity: 0.7 }}
                />
                <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                  Today
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          data-tour="gantt-chart"
          ref={scrollRef}
          className="overflow-x-auto rounded-xl border border-[var(--border)]"
          style={{ background: "var(--bg-void)" }}
        >
          <div style={{ minWidth: LABEL_COL_WIDTH + TIMELINE_MIN_WIDTH }}>
            {/* ── Header row with ticks ── */}
            <div
              className="flex sticky top-0 z-10"
              style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-deep)",
              }}
            >
              {/* Label column header */}
              <div
                className="shrink-0 px-4 py-2.5"
                style={{
                  width: LABEL_COL_WIDTH,
                  borderRight: "1px solid var(--border)",
                }}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  Task
                </span>
              </div>

              {/* Timeline header */}
              <div className="flex-1 relative" style={{ height: 36 }}>
                {ticks.map((tick, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full flex items-center"
                    style={{ left: `${tick.pct}%` }}
                  >
                    <span
                      className={`font-mono text-[9px] uppercase tracking-[0.08em] whitespace-nowrap pl-1.5 ${
                        tick.isMonth
                          ? "text-[var(--text-secondary)]"
                          : "text-[var(--text-tertiary)]"
                      }`}
                    >
                      {tick.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Project groups ── */}
            {Object.entries(groupedByProject).map(
              ([pid, { name, tasks: projectTasks }]) => (
                <div key={pid}>
                  {/* Project group header */}
                  <div
                    className="flex"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.015)",
                    }}
                  >
                    <div
                      className="shrink-0 px-4 py-2"
                      style={{
                        width: LABEL_COL_WIDTH,
                        borderRight: "1px solid var(--border)",
                      }}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-lime">
                        {name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)] ml-2">
                        {projectTasks.length}
                      </span>
                    </div>
                    <div className="flex-1" />
                  </div>

                  {/* Task rows */}
                  {projectTasks.map((task) => {
                    const bar = getBarStyle(task);
                    const isCritical = task.priority === "CRITICAL";

                    return (
                      <div
                        key={task.id}
                        className="flex group"
                        style={{
                          borderBottom: "1px solid var(--border)",
                        }}
                        onMouseEnter={(e) => {
                          setTooltip({
                            task,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onMouseMove={(e) => {
                          setTooltip((prev) =>
                            prev
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : null
                          );
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {/* Task label */}
                        <div
                          className="shrink-0 px-4 py-2.5 flex items-center gap-2 min-w-0"
                          style={{
                            width: LABEL_COL_WIDTH,
                            borderRight: "1px solid var(--border)",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              background: STATUS_COLOR[task.status],
                            }}
                          />
                          <span className="text-xs text-[var(--text-secondary)] truncate group-hover:text-[var(--text-primary)] transition-colors">
                            {task.title}
                          </span>
                        </div>

                        {/* Timeline area */}
                        <div className="flex-1 relative py-2">
                          {/* Vertical grid lines */}
                          {ticks.map((tick, i) => (
                            <div
                              key={i}
                              className="absolute top-0 bottom-0"
                              style={{
                                left: `${tick.pct}%`,
                                width: 1,
                                background: "var(--border)",
                              }}
                            />
                          ))}

                          {/* Today marker */}
                          <div
                            className="absolute top-0 bottom-0 z-[5]"
                            style={{
                              left: `${todayPct}%`,
                              width: 1,
                              borderLeft: "1px dashed var(--lime)",
                              opacity: 0.5,
                            }}
                          />

                          {/* Task bar */}
                          {bar.isDot ? (
                            <div
                              className="absolute top-1/2 -translate-y-1/2 z-[6]"
                              style={{
                                left: bar.left,
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: STATUS_COLOR[task.status],
                                border: `2px solid ${PRIORITY_BORDER[task.priority]}`,
                                boxShadow:
                                  isCritical
                                    ? `0 0 6px var(--coral), 0 0 12px rgba(248,113,113,0.3)`
                                    : undefined,
                              }}
                            />
                          ) : (
                            <div
                              className="absolute top-1/2 -translate-y-1/2 z-[6] rounded"
                              style={{
                                left: bar.left,
                                width: bar.width,
                                height: 20,
                                background: STATUS_BG[task.status],
                                borderLeft: `3px solid ${PRIORITY_BORDER[task.priority]}`,
                                boxShadow:
                                  isCritical
                                    ? `0 0 8px rgba(248,113,113,0.25)`
                                    : undefined,
                                animation:
                                  isCritical
                                    ? "gantt-pulse 2s ease-in-out infinite"
                                    : undefined,
                              }}
                            >
                              {/* Inner bar fill for status */}
                              <div
                                className="h-full rounded-r"
                                style={{
                                  background: STATUS_COLOR[task.status],
                                  opacity: 0.2,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* ── Legend row ── */}
            <div
              className="flex items-center gap-6 px-4 py-3"
              style={{
                borderTop: "1px solid var(--border)",
                background: "var(--bg-deep)",
              }}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mr-1">
                Status
              </span>
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: STATUS_COLOR[key] }}
                  />
                  <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                    {label}
                  </span>
                </div>
              ))}
              <span className="opacity-20 text-[var(--text-tertiary)]">|</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mr-1">
                Priority
              </span>
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((p) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span
                    className="w-0.5 h-3 rounded-full"
                    style={{ background: PRIORITY_BORDER[p] }}
                  />
                  <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                    {p}
                  </span>
                </div>
              ))}
              <span className="opacity-20 text-[var(--text-tertiary)]">|</span>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-0"
                  style={{
                    borderTop: "1px dashed var(--lime)",
                    opacity: 0.5,
                  }}
                />
                <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                  Today
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && <Tooltip data={tooltip} />}

      {/* Critical pulse animation */}
      <style>{`
        @keyframes gantt-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(248,113,113,0.15); }
          50% { box-shadow: 0 0 12px rgba(248,113,113,0.35); }
        }
      `}</style>
      <PageTour pageKey="dev-gantt" />
    </div>
  );
}
