"use client";

import { useEffect, useState, useCallback } from "react";

interface Member {
  id: string;
  name: string;
}

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
  assignee: { id: string; name: string } | null;
  tags: Tag[];
  subtasks: Task[];
}

interface Project {
  id: string;
  name: string;
  description: string;
  repoUrl: string | null;
  members: Member[];
  taskCounts: Record<string, number>;
}

const COLUMNS: { key: string; label: string }[] = [
  { key: "BACKLOG", label: "Backlog" },
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "REVIEW", label: "Review" },
  { key: "DONE", label: "Done" },
];

const STATUS_OPTIONS = COLUMNS.map((c) => c.key);

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

const COLUMN_ACCENT: Record<string, string> = {
  BACKLOG: "text-text-tertiary",
  TODO: "text-blue",
  IN_PROGRESS: "text-amber",
  REVIEW: "text-violet",
  DONE: "text-mint",
};

const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

type GroupMode = "status" | "tag";

export default function DevDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("status");

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPriority, setFormPriority] = useState("MEDIUM");
  const [formAssignee, setFormAssignee] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formParentId, setFormParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Edit modal state
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState("MEDIUM");
  const [editAssignee, setEditAssignee] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editParentId, setEditParentId] = useState("");
  const [editStatus, setEditStatus] = useState("BACKLOG");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Project creation state
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projRepo, setProjRepo] = useState("");
  const [projSubmitting, setProjSubmitting] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const fetchTasks = useCallback(() => {
    if (!selectedProjectId) return;
    setTasksLoading(true);
    fetch(`/api/projects/${selectedProjectId}/tasks`)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((data) => setTasks(data.tasks || []))
      .catch(() => {})
      .finally(() => setTasksLoading(false));
  }, [selectedProjectId]);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
    ])
      .then(([projData, tagData]) => {
        const list = projData.projects || [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(list[0].id);
        setAllTags(tagData.tags || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

  function toggleTag(tagId: string) {
    setFormTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }

  function resetForm() {
    setShowForm(false);
    setFormTitle("");
    setFormDesc("");
    setFormPriority("MEDIUM");
    setFormAssignee("");
    setFormDeadline("");
    setFormTags([]);
    setFormParentId("");
  }

  function openEdit(task: Task) {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || "");
    setEditPriority(task.priority);
    setEditAssignee(task.assignee?.id || "");
    setEditDeadline(task.deadline ? task.deadline.slice(0, 10) : "");
    setEditTags(task.tags.map((t) => t.id));
    setEditParentId("");
    setEditStatus(task.status);
    setConfirmDelete(false);
  }

  function closeEdit() {
    setEditingTask(null);
    setConfirmDelete(false);
  }

  function toggleEditTag(tagId: string) {
    setEditTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTask || !editTitle.trim()) return;
    setSaving(true);

    const body: Record<string, unknown> = {
      title: editTitle.trim(),
      description: editDesc.trim() || null,
      priority: editPriority,
      status: editStatus,
      assigneeId: editAssignee || null,
      deadline: editDeadline || null,
      tagIds: editTags,
      parentId: editParentId || null,
    };

    const res = await fetch(`/api/tasks/${editingTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      closeEdit();
      fetchTasks();
    }
    setSaving(false);
  }

  async function handleDeleteTask() {
    if (!editingTask) return;
    setDeleting(true);
    const res = await fetch(`/api/tasks/${editingTask.id}`, { method: "DELETE" });
    if (res.ok) {
      closeEdit();
      fetchTasks();
    }
    setDeleting(false);
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projName.trim() || !projDesc.trim()) return;
    setProjSubmitting(true);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projName.trim(),
        description: projDesc.trim(),
        repoUrl: projRepo.trim() || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const newProj = data.project;
      setProjects((prev) => [
        {
          id: newProj.id,
          name: newProj.name,
          description: newProj.description,
          repoUrl: newProj.repoUrl,
          members: newProj.members || [],
          taskCounts: { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 },
        },
        ...prev,
      ]);
      setSelectedProjectId(newProj.id);
      setShowProjectForm(false);
      setProjName("");
      setProjDesc("");
      setProjRepo("");
    }
    setProjSubmitting(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !selectedProjectId) return;
    setSubmitting(true);

    const body: Record<string, unknown> = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      priority: formPriority,
      assigneeId: formAssignee || null,
      deadline: formDeadline || null,
      tagIds: formTags.length ? formTags : undefined,
      parentId: formParentId || null,
    };

    const res = await fetch(`/api/projects/${selectedProjectId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      resetForm();
      fetchTasks();
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-64 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold mb-8">
          Project <span className="font-display text-lime">Board</span>
        </h1>
        <div className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No projects yet.</p>
          {!showProjectForm ? (
            <button
              onClick={() => setShowProjectForm(true)}
              className="bg-lime text-bg-void font-semibold px-5 py-2 rounded-full text-sm hover:bg-lime/90 transition-colors mt-2"
            >
              + New Project
            </button>
          ) : (
            <form onSubmit={handleCreateProject} className="text-left mt-4 max-w-md mx-auto space-y-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="My Project"
                  required
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Description
                </label>
                <textarea
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder="What is this project about?"
                  required
                  rows={2}
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30 resize-none"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Repo URL (optional)
                </label>
                <input
                  type="url"
                  value={projRepo}
                  onChange={(e) => setProjRepo(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={projSubmitting || !projName.trim() || !projDesc.trim()}
                  className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
                >
                  {projSubmitting ? "Creating..." : "Create Project"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowProjectForm(false)}
                  className="px-4 py-2.5 rounded-full text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  const tasksByStatus: Record<string, Task[]> = {};
  for (const col of COLUMNS) {
    tasksByStatus[col.key] = tasks.filter((t) => t.status === col.key);
  }

  const uniqueTagsInTasks = allTags.filter((tag) =>
    tasks.some((t) => t.tags.some((tt) => tt.id === tag.id))
  );
  const tasksByTag: Record<string, Task[]> = {};
  for (const tag of uniqueTagsInTasks) {
    tasksByTag[tag.id] = tasks.filter((t) => t.tags.some((tt) => tt.id === tag.id));
  }
  const untagged = tasks.filter((t) => t.tags.length === 0);
  if (untagged.length > 0) tasksByTag["_untagged"] = untagged;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">
          Project <span className="font-display text-lime">Board</span>
        </h1>
        <div className="flex items-center gap-3">
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-lime/30"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setShowProjectForm(!showProjectForm);
              if (showForm) resetForm();
            }}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors border ${
              showProjectForm
                ? "border-coral/30 text-coral hover:bg-coral/10"
                : "border-[var(--border)] text-text-secondary hover:text-text-primary"
            }`}
          >
            {showProjectForm ? "Cancel" : "+ Project"}
          </button>
          <button
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setShowForm(true);
                setShowProjectForm(false);
              }
            }}
            className="bg-lime text-bg-void font-semibold px-5 py-2 rounded-full text-sm hover:bg-lime/90 transition-colors"
          >
            {showForm ? "Cancel" : "+ New Task"}
          </button>
        </div>
      </div>

      {showProjectForm && (
        <form onSubmit={handleCreateProject} className="card p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Project Name
              </label>
              <input
                type="text"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="My Project"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Repo URL (optional)
              </label>
              <input
                type="url"
                value={projRepo}
                onChange={(e) => setProjRepo(e.target.value)}
                placeholder="https://github.com/..."
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Description
              </label>
              <textarea
                value={projDesc}
                onChange={(e) => setProjDesc(e.target.value)}
                placeholder="What is this project about?"
                required
                rows={2}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30 resize-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={projSubmitting || !projName.trim() || !projDesc.trim()}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {projSubmitting ? "Creating..." : "Create Project"}
          </button>
        </form>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="sm:col-span-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Title
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Task title"
                required
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Description
              </label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30 resize-none"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Priority
              </label>
              <select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Assignee
              </label>
              <select
                value={formAssignee}
                onChange={(e) => setFormAssignee(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                <option value="">Unassigned</option>
                {selectedProject?.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Deadline
              </label>
              <input
                type="date"
                value={formDeadline}
                onChange={(e) => setFormDeadline(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Parent Task (subtask of)
              </label>
              <select
                value={formParentId}
                onChange={(e) => setFormParentId(e.target.value)}
                className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
              >
                <option value="">None (top-level task)</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
              Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const selected = formTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
                    style={{
                      backgroundColor: selected ? tag.color + "30" : "transparent",
                      borderColor: selected ? tag.color : "var(--border)",
                      color: selected ? tag.color : "var(--text-secondary)",
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !formTitle.trim()}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? "Creating..." : "Create Task"}
          </button>
        </form>
      )}

      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Group by
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
      </div>

      {tasksLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="skeleton h-6 w-24 mb-3" />
              <div className="space-y-3">
                {[...Array(2)].map((__, j) => (
                  <div key={j} className="skeleton h-28 w-full rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : groupMode === "status" ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {COLUMNS.map((col) => {
            const colTasks = tasksByStatus[col.key];
            return (
              <div key={col.key} className="min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.1em] ${COLUMN_ACCENT[col.key]}`}
                  >
                    {col.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-tertiary">
                    {colTasks.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {colTasks.length === 0 ? (
                    <div className="border border-dashed border-[var(--border)] rounded-xl p-4 text-center">
                      <p className="text-text-tertiary text-xs">No tasks</p>
                    </div>
                  ) : (
                    colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={handleStatusChange}
                        onEdit={openEdit}
                        expanded={expandedTasks.has(task.id)}
                        onToggleExpand={() => toggleExpand(task.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {Object.entries(tasksByTag).map(([tagId, tagTasks]) => {
            const tag =
              tagId === "_untagged"
                ? { name: "Untagged", color: "#888888" }
                : uniqueTagsInTasks.find((t) => t.id === tagId) || {
                    name: "Unknown",
                    color: "#888888",
                  };
            return (
              <div key={tagId} className="min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-secondary">
                    {tag.name}
                  </span>
                  <span className="font-mono text-[10px] text-text-tertiary">
                    {tagTasks.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {tagTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onStatusChange={handleStatusChange}
                      onEdit={openEdit}
                      expanded={expandedTasks.has(task.id)}
                      onToggleExpand={() => toggleExpand(task.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeEdit} />
          <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">Edit Task</h2>
              <button
                onClick={closeEdit}
                className="text-text-tertiary hover:text-text-primary transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Description
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                    Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                    Priority
                  </label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                    Assignee
                  </label>
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  >
                    <option value="">Unassigned</option>
                    {selectedProject?.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                    Deadline
                  </label>
                  <input
                    type="date"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                  />
                </div>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Parent Task
                </label>
                <select
                  value={editParentId}
                  onChange={(e) => setEditParentId(e.target.value)}
                  className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-lime/30"
                >
                  <option value="">None (top-level task)</option>
                  {tasks
                    .filter((t) => t.id !== editingTask.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                  Tags
                </label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => {
                    const selected = editTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleEditTag(tag.id)}
                        className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
                        style={{
                          backgroundColor: selected ? tag.color + "30" : "transparent",
                          borderColor: selected ? tag.color : "var(--border)",
                          color: selected ? tag.color : "var(--text-secondary)",
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="submit"
                  disabled={saving || !editTitle.trim()}
                  className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-coral text-sm hover:text-coral/80 transition-colors"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary">
                      {editingTask.subtasks.length > 0
                        ? `Delete with ${editingTask.subtasks.length} subtask${editingTask.subtasks.length !== 1 ? "s" : ""}?`
                        : "Are you sure?"}
                    </span>
                    <button
                      type="button"
                      onClick={handleDeleteTask}
                      disabled={deleting}
                      className="bg-coral/20 text-coral px-3 py-1 rounded-full text-xs font-semibold hover:bg-coral/30 disabled:opacity-40 transition-colors"
                    >
                      {deleting ? "Deleting..." : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-text-tertiary text-xs hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onStatusChange,
  onEdit,
  expanded,
  onToggleExpand,
}: {
  task: Task;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (task: Task) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <div className="card p-4 cursor-pointer hover:border-[var(--lime)]/20 transition-colors" onClick={() => onEdit(task)}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 rounded ${PRIORITY_COLOR[task.priority]} ${PRIORITY_BG[task.priority]}`}
        >
          {task.priority}
        </span>
        {task.tags.map((tag) => (
          <span
            key={tag.id}
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
            style={{
              backgroundColor: tag.color + "25",
              color: tag.color,
            }}
          >
            {tag.name}
          </span>
        ))}
      </div>
      <div className="text-sm font-medium mb-2 leading-snug">{task.title}</div>
      {task.description && (
        <div className="text-text-tertiary text-xs mb-2 line-clamp-2">
          {task.description}
        </div>
      )}
      {task.assignee && (
        <div className="text-text-secondary text-xs mb-2">{task.assignee.name}</div>
      )}
      {task.deadline && (
        <div className="text-text-tertiary text-xs mb-2">
          Due {new Date(task.deadline).toLocaleDateString()}
        </div>
      )}

      {task.subtasks.length > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors mb-2"
        >
          <span className="font-mono text-[10px]">
            {expanded ? "v" : ">"}
          </span>
          <span>
            {task.subtasks.length} subtask{task.subtasks.length !== 1 ? "s" : ""}
          </span>
          <span className="text-text-tertiary">
            ({task.subtasks.filter((s) => s.status === "DONE").length}/
            {task.subtasks.length} done)
          </span>
        </button>
      )}

      {expanded && task.subtasks.length > 0 && (
        <div className="border-l-2 border-[var(--border)] pl-3 ml-1 mb-2 space-y-2">
          {task.subtasks.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-2 text-xs"
            >
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
              {sub.tags.map((tag) => (
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
            </div>
          ))}
        </div>
      )}

      <select
        value={task.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); onStatusChange(task.id, e.target.value); }}
        className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:border-lime/30"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
