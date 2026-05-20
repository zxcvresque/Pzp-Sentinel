"use client";

import { useEffect, useState } from "react";

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
  deadline: string | null;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  tags: Tag[];
  subtasks: Task[];
}

const STATUS_ORDER = ["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "DONE"];

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: "Backlog",
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  DONE: "Done",
};

const STATUS_ACCENT: Record<string, string> = {
  BACKLOG: "text-text-tertiary",
  TODO: "text-blue",
  IN_PROGRESS: "text-amber",
  REVIEW: "text-violet",
  DONE: "text-mint",
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW: "text-text-tertiary",
  MEDIUM: "text-blue",
  HIGH: "text-amber",
  CRITICAL: "text-coral",
};

const PRIORITY_BG: Record<string, string> = {
  LOW: "bg-[var(--bg-elevated)]",
  MEDIUM: "bg-[var(--blue-dim)]",
  HIGH: "bg-[var(--amber-dim)]",
  CRITICAL: "bg-[var(--coral-dim)]",
};

const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

type GroupMode = "status" | "tag";

export default function DevTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [filterTag, setFilterTag] = useState<string>("");

  useEffect(() => {
    fetch("/api/tasks/mine")
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((data) => setTasks(data.tasks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleStatusChange(taskId: string, newStatus: string) {
    const prev = tasks;
    setTasks((t) =>
      t.map((task) => (task.id === taskId ? { ...task, status: newStatus } : task))
    );
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) setTasks(prev);
  }

  function toggleExpand(id: string) {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allTagsInTasks: Tag[] = [];
  const seenTagIds = new Set<string>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      if (!seenTagIds.has(tag.id)) {
        seenTagIds.add(tag.id);
        allTagsInTasks.push(tag);
      }
    }
  }
  allTagsInTasks.sort((a, b) => a.name.localeCompare(b.name));

  const filtered = filterTag
    ? tasks.filter((t) => t.tags.some((tag) => tag.id === filterTag))
    : tasks;

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="mb-6">
            <div className="skeleton h-4 w-24 mb-3" />
            <div className="skeleton h-20 w-full rounded-xl mb-2" />
            <div className="skeleton h-20 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  const groupedByStatus: Record<string, Task[]> = {};
  for (const status of STATUS_ORDER) {
    const statusTasks = filtered
      .filter((t) => t.status === status)
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      );
    if (statusTasks.length > 0) groupedByStatus[status] = statusTasks;
  }

  const groupedByTag: Record<string, { tag: Tag | null; tasks: Task[] }> = {};
  for (const tag of allTagsInTasks) {
    const tagTasks = filtered
      .filter((t) => t.tags.some((tt) => tt.id === tag.id))
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      );
    if (tagTasks.length > 0) {
      groupedByTag[tag.id] = { tag, tasks: tagTasks };
    }
  }
  const untagged = filtered.filter((t) => t.tags.length === 0);
  if (untagged.length > 0) {
    groupedByTag["_untagged"] = { tag: null, tasks: untagged };
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">
          My <span className="font-display text-lime">Tasks</span>
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Group
        </span>
        <button
          onClick={() => setGroupMode("status")}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            groupMode === "status"
              ? "bg-lime/20 text-lime border border-lime/30"
              : "bg-bg-deep text-text-secondary border border-[var(--border)] hover:text-text-primary"
          }`}
        >
          Status
        </button>
        <button
          onClick={() => setGroupMode("tag")}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            groupMode === "tag"
              ? "bg-lime/20 text-lime border border-lime/30"
              : "bg-bg-deep text-text-secondary border border-[var(--border)] hover:text-text-primary"
          }`}
        >
          Tag
        </button>

        {allTagsInTasks.length > 0 && (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary ml-4">
              Filter
            </span>
            <button
              onClick={() => setFilterTag("")}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                !filterTag
                  ? "bg-lime/20 text-lime border border-lime/30"
                  : "bg-bg-deep text-text-secondary border border-[var(--border)] hover:text-text-primary"
              }`}
            >
              All
            </button>
            {allTagsInTasks.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setFilterTag(filterTag === tag.id ? "" : tag.id)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
                style={{
                  backgroundColor:
                    filterTag === tag.id ? tag.color + "30" : "transparent",
                  borderColor: filterTag === tag.id ? tag.color : "var(--border)",
                  color: filterTag === tag.id ? tag.color : "var(--text-secondary)",
                }}
              >
                {tag.name}
              </button>
            ))}
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">
            {filterTag ? "No tasks match this filter." : "No tasks assigned to you."}
          </p>
          <p className="text-text-tertiary text-sm">
            {filterTag
              ? "Try a different tag or clear the filter."
              : "Tasks assigned to you across all projects will appear here."}
          </p>
        </div>
      ) : groupMode === "status" ? (
        <div className="space-y-8">
          {Object.keys(groupedByStatus).map((status) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`font-mono text-[11px] uppercase tracking-[0.1em] ${STATUS_ACCENT[status]}`}
                >
                  {STATUS_LABELS[status]}
                </span>
                <span className="font-mono text-[10px] text-text-tertiary">
                  {groupedByStatus[status].length}
                </span>
              </div>
              <div className="space-y-3">
                {groupedByStatus[status].map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    expanded={expandedTasks.has(task.id)}
                    onToggleExpand={() => toggleExpand(task.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedByTag).map(([tagId, { tag, tasks: tagTasks }]) => (
            <div key={tagId}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: tag?.color || "#888888" }}
                />
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-secondary">
                  {tag?.name || "Untagged"}
                </span>
                <span className="font-mono text-[10px] text-text-tertiary">
                  {tagTasks.length}
                </span>
              </div>
              <div className="space-y-3">
                {tagTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    expanded={expandedTasks.has(task.id)}
                    onToggleExpand={() => toggleExpand(task.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onStatusChange,
  expanded,
  onToggleExpand,
}: {
  task: Task;
  onStatusChange: (id: string, status: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium truncate">{task.title}</span>
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded shrink-0 ${PRIORITY_COLOR[task.priority]} ${PRIORITY_BG[task.priority]}`}
            >
              {task.priority}
            </span>
            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                style={{
                  backgroundColor: tag.color + "25",
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            <span>{task.project.name}</span>
            {task.deadline && (
              <>
                <span className="opacity-30">|</span>
                <span>Due {new Date(task.deadline).toLocaleDateString()}</span>
              </>
            )}
          </div>
          {task.description && (
            <div className="text-text-tertiary text-xs mt-1 line-clamp-1">
              {task.description}
            </div>
          )}
        </div>
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          className="bg-bg-deep border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-lime/30 shrink-0"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {task.subtasks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <span className="font-mono text-[10px]">
              {expanded ? "v" : ">"}
            </span>
            <span>
              {task.subtasks.length} subtask
              {task.subtasks.length !== 1 ? "s" : ""}
            </span>
            <span>
              ({task.subtasks.filter((s) => s.status === "DONE").length}/
              {task.subtasks.length} done)
            </span>
          </button>

          {expanded && (
            <div className="mt-2 border-l-2 border-[var(--border)] pl-3 ml-1 space-y-2">
              {task.subtasks.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      sub.status === "DONE" ? "bg-mint" : "bg-text-tertiary"
                    }`}
                  />
                  <span
                    className={
                      sub.status === "DONE"
                        ? "text-text-tertiary line-through"
                        : "text-text-secondary"
                    }
                  >
                    {sub.title}
                  </span>
                  {sub.tags?.map((tag) => (
                    <span
                      key={tag.id}
                      className="px-1.5 py-0 rounded-full text-[9px] font-semibold"
                      style={{
                        backgroundColor: tag.color + "25",
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  <span
                    className={`ml-auto font-mono text-[9px] uppercase ${
                      STATUS_ACCENT[sub.status] || "text-text-tertiary"
                    }`}
                  >
                    {STATUS_LABELS[sub.status] || sub.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
