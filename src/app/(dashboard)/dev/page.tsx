"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Dropdown from "@/components/Dropdown";
import TgUser from "@/components/TgUser";
import FormExample from "@/components/FormExample";
import PageTour from "@/components/PageTour";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface Member {
  id: string;
  name: string;
  photoUrl?: string | null;
  projectRole?: "LEAD" | "MEMBER" | "VIEWER";
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
  createdById?: string | null;
  assignee: { id: string; name: string; photoUrl?: string | null } | null;
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
  archivedAt?: string | null;
}

interface ActivityItem {
  id: string;
  type: "push" | "pr" | "branch" | "release" | "issue" | "review" | "fork" | "star";
  repo: string;
  title: string;
  author: string;
  avatar: string | null;
  date: string;
  url: string;
  sha?: string;
  meta?: Record<string, unknown>;
}

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("status");

  // Current-user awareness — gates task actions to match the strict task API.
  const [meId, setMeId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPriority, setFormPriority] = useState("MEDIUM");
  const [formStatus, setFormStatus] = useState("TODO");
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
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [developers, setDevelopers] = useState<Member[]>([]);
  const [projectMemberRoles, setProjectMemberRoles] = useState<Record<string, "LEAD" | "MEMBER" | "VIEWER">>({});

  // Org-wide git activity
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityOpen, setActivityOpen] = useState(true);

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

  // Keep the latest selected project in a ref so `load` can stay stable ([] deps)
  // while still refetching the currently-selected project's tasks.
  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  // Stable, data-only refresh used for background re-fetches. Refreshes every
  // endpoint the view is built from. Never toggles loading/skeleton state and
  // never clears existing data first (no flicker); failures are swallowed so a
  // failed background refresh keeps the last good data with no error flash.
  const load = useCallback(async () => {
    try {
      const projectId = selectedProjectIdRef.current;
      const [projData, archivedData, tagData] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/projects?archived=true").then((r) => r.ok ? r.json() : { projects: [] }),
        projectId ? fetch(`/api/tags?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()) : Promise.resolve({ tags: [] }),
      ]);
      const list = projData.projects || [];
      setProjects(list);
      setArchivedProjects(archivedData.projects || []);
      setAllTags(tagData.tags || []);
    } catch {
      // keep last good data
    }

    const projectId = selectedProjectIdRef.current;
    if (projectId) {
      try {
        const data = await fetch(`/api/projects/${projectId}/tasks`).then((r) =>
          r.ok ? r.json() : { tasks: [] }
        );
        setTasks(data.tasks || []);
      } catch {
        // keep last good data
      }
    }

    try {
      const data = await fetch("/api/github/activity").then((r) =>
        r.ok ? r.json() : { activity: [] }
      );
      setActivity(data.activity || []);
    } catch {
      // keep last good data
    }
  }, []);

  useEffect(() => {
    fetch("/api/developers").then((response) => response.ok ? response.json() : { developers: [] }).then((data) => setDevelopers(data.developers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([fetch("/api/projects").then((r) => r.json()), fetch("/api/projects?archived=true").then((r) => r.ok ? r.json() : { projects: [] })])
      .then(([projData, archivedData]) => {
        const list = projData.projects || [];
        setProjects(list);
        setArchivedProjects(archivedData.projects || []);
        if (list.length > 0) setSelectedProjectId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      const timer = window.setTimeout(() => setAllTags([]), 0);
      return () => window.clearTimeout(timer);
    }
    fetch(`/api/tags?projectId=${encodeURIComponent(selectedProjectId)}`)
      .then((response) => response.ok ? response.json() : { tags: [] })
      .then((data) => setAllTags(data.tags || []))
      .catch(() => setAllTags([]));
  }, [selectedProjectId]);

  useEffect(() => {
    const timer = setTimeout(fetchTasks, 0);
    return () => clearTimeout(timer);
  }, [fetchTasks]);

  // Fetch org-wide git activity once on mount
  useEffect(() => {
    fetch("/api/github/activity")
      .then((r) => (r.ok ? r.json() : { activity: [] }))
      .then((data) => setActivity(data.activity || []))
      .catch(() => setActivity([]));
  }, []);

  // Fetch the current user once on mount to drive per-task permissions.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) return;
        setMeId(data.user.id);
        setIsAdmin(data.user.roles.includes("ADMIN"));
      })
      .catch(() => {});
  }, []);

  useAutoRefresh(load, 30000);

  // Per-task permission gates mirroring the strict task API:
  //  - status: ADMIN, or the task's assignee (DEV may PATCH status on own tasks)
  //  - delete: ADMIN, or the task's creator
  // A dev fully manages their own tasks (assigned to or created by them); admins manage all.
  const canManage = (t: Task) => isAdmin || t.assignee?.id === meId || t.createdById === meId;
  const canDelete = (t: Task) => isAdmin || t.createdById === meId;

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
    setFormStatus("TODO");
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

  function resetProjectForm() {
    setShowProjectForm(false);
    setEditingProjectId(null);
    setProjName("");
    setProjDesc("");
    setProjRepo("");
    setProjectMemberRoles({});
  }

  function openCreateProject() {
    resetProjectForm();
    setShowProjectForm(true);
    if (showForm) resetForm();
  }

  function openEditProject() {
    if (!selectedProject) return;
    setEditingProjectId(selectedProject.id);
    setProjName(selectedProject.name);
    setProjDesc(selectedProject.description);
    setProjRepo(selectedProject.repoUrl || "");
    setProjectMemberRoles(Object.fromEntries(selectedProject.members.map((member) => [member.id, member.projectRole || "MEMBER"])));
    setShowProjectForm(true);
    if (showForm) resetForm();
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projName.trim() || !projDesc.trim()) return;
    setProjSubmitting(true);

    const res = await fetch(editingProjectId ? `/api/projects/${editingProjectId}` : "/api/projects", {
      method: editingProjectId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projName.trim(),
        description: projDesc.trim(),
        repoUrl: projRepo.trim() || null,
        ...(editingProjectId
          ? { members: Object.entries(projectMemberRoles).map(([userId, role]) => ({ userId, role })) }
          : { memberIds: Object.keys(projectMemberRoles) }),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const newProj = data.project;
      const normalized = {
        id: newProj.id,
        name: newProj.name,
        description: newProj.description,
        repoUrl: newProj.repoUrl,
        members: newProj.members || [],
        taskCounts: editingProjectId
          ? selectedProject?.taskCounts || {}
          : { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 },
      };
      setProjects((prev) => editingProjectId
        ? prev.map((project) => project.id === editingProjectId ? normalized : project)
        : [normalized, ...prev]);
      setSelectedProjectId(newProj.id);
      resetProjectForm();
    }
    setProjSubmitting(false);
  }

  async function handleDeleteProject() {
    if (!selectedProject) return;
    setDeletingProject(true);
    const deletingId = selectedProject.id;
    const res = await fetch(`/api/projects/${deletingId}`, { method: "DELETE" });
    if (res.ok) {
      const remaining = projects.filter((project) => project.id !== deletingId);
      setProjects(remaining);
      setSelectedProjectId(remaining[0]?.id || "");
      setTasks([]);
      resetProjectForm();
      setConfirmProjectDelete(false);
      const archivedData = await fetch("/api/projects?archived=true").then((response) => response.ok ? response.json() : { projects: [] });
      setArchivedProjects(archivedData.projects || []);
    }
    setDeletingProject(false);
  }

  async function restoreProject(project: Project) {
    const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: true }) });
    if (!response.ok) return;
    const restored = { ...project, archivedAt: null };
    setArchivedProjects((current) => current.filter((item) => item.id !== project.id));
    setProjects((current) => [restored, ...current]);
    setSelectedProjectId(project.id);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !selectedProjectId) return;
    setSubmitting(true);

    const body: Record<string, unknown> = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      priority: formPriority,
      status: formStatus,
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

  // Activity panel — collapsible right sidebar on desktop, full-width on mobile
  const activityPanel = (
    <div
      className={`rounded-xl border border-[var(--border)] overflow-hidden transition-all ${
        activityOpen ? "lg:w-80 xl:w-96" : ""
      }`}
      style={{ background: "var(--bg-card)" }}
    >
      {/* Header */}
      <button
        data-tour="activity-panel"
        onClick={() => setActivityOpen(!activityOpen)}
        className="flex items-center gap-2.5 w-full px-4 py-3 text-left group"
        style={{ background: "var(--bg-deep)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-lime shrink-0">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="3" x2="12" y2="9" />
          <line x1="12" y1="15" x2="12" y2="21" />
        </svg>
        {activityOpen ? (
          <>
            <span className="text-sm font-semibold text-text-primary">
              Recent Repo Activities
            </span>
            {activity.length > 0 && (
              <span className="font-mono text-[10px] bg-lime/15 text-lime px-1.5 py-0.5 rounded-full">{activity.length}</span>
            )}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-tertiary ml-auto hover:text-text-secondary transition-colors">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-text-secondary whitespace-nowrap">Git Feed</span>
            {activity.length > 0 && (
              <span className="font-mono text-[10px] bg-lime/15 text-lime px-1.5 py-0.5 rounded-full">{activity.length}</span>
            )}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-tertiary ml-auto shrink-0">
              <path d="M5 3l6 5-6 5" />
            </svg>
          </>
        )}
      </button>

      {/* Feed */}
      {activityOpen && (
        <div className="overflow-y-auto max-h-[70vh]">
          {activity.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-text-secondary text-sm mb-1">No activity yet</p>
              <p className="text-text-tertiary text-xs">
                Admin needs to track repos for activity to appear.
              </p>
            </div>
          ) : (
            activity.slice(0, 30).map((item, i) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-3 hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                style={{
                  borderBottom:
                    i < Math.min(activity.length, 30) - 1
                      ? "1px solid var(--border)"
                      : undefined,
                }}
              >
                {/* Row 1: repo + time */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-text-primary">{item.repo}</span>
                  <span className="font-mono text-[10px] text-text-tertiary ml-auto shrink-0">
                    {timeAgo(item.date)}
                  </span>
                </div>
                {/* Row 2: type badge + commit message */}
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 mt-0.5 font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded leading-none ${
                    item.type === "push" ? "text-lime bg-lime/10" :
                    item.type === "pr" ? (item.meta?.action === "merged" ? "text-violet bg-violet/10" : "text-blue bg-blue/10") :
                    item.type === "branch" ? "text-amber bg-amber/10" :
                    item.type === "release" ? "text-mint bg-mint/10" :
                    item.type === "issue" ? "text-coral bg-coral/10" :
                    item.type === "review" ? "text-violet bg-violet/10" :
                    "text-text-tertiary"
                  }`}>
                    {item.type === "push" && item.sha ? item.sha :
                     item.type === "pr" ? (item.meta?.action === "merged" ? "merged" : "PR") :
                     item.type === "branch" ? "branch" :
                     item.type === "release" ? "release" :
                     item.type === "issue" ? "issue" :
                     item.type === "review" ? "review" : "?"}
                  </span>
                  <p className="text-xs text-text-secondary leading-snug line-clamp-2 flex-1 min-w-0">
                    {item.title}
                  </p>
                </div>
                {/* Row 3: author */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  {item.avatar && (
                    <img src={item.avatar} alt="" className="w-3.5 h-3.5 rounded-full" />
                  )}
                  <span className="text-[11px] text-text-tertiary">{item.author}</span>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );

  if (projects.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold mb-8">
          Project <span className="font-display text-lime">Board</span>
        </h1>
        <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
        <div className="flex-1 min-w-0">
        <div data-tour="kanban-board" className="card p-8 text-center">
          <p className="text-text-secondary mb-2">No projects yet.</p>
          {!showProjectForm ? (
            <button
              data-tour="board-actions"
              onClick={openCreateProject}
              className="bg-lime text-bg-void font-semibold px-5 py-2 rounded-full text-sm hover:bg-lime/90 transition-colors mt-2"
            >
              + New Project
            </button>
          ) : (
            <form onSubmit={handleSaveProject} className="text-left mt-4 max-w-md mx-auto space-y-4">
              <FormExample lines={["Name: PzP Dashboard · Repo: github.com/org/repo", "Description: Internal finance management tool"]} />
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
                  onClick={resetProjectForm}
                  className="px-4 py-2.5 rounded-full text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
        </div>
        <div className="block lg:hidden mt-4">{activityPanel}</div>
        <div className="hidden lg:block shrink-0 sticky top-4">{activityPanel}</div>
        </div>
        <PageTour pageKey="dev-board" />
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
    <>
    <ConfirmDialog
      open={confirmProjectDelete}
      onClose={() => setConfirmProjectDelete(false)}
      onConfirm={handleDeleteProject}
      title={`Archive ${selectedProject?.name || "project"}?`}
      message="The project and its tasks will leave active boards, but can be restored later."
      confirmLabel="Archive Project"
      loading={deletingProject}
    />
    <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
      <div className="flex-1 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">
          Project <span className="font-display text-lime">Board</span>
        </h1>
        <div data-tour="board-actions" className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Dropdown
            value={selectedProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setSelectedProjectId}
          />
          <button
            onClick={openEditProject}
            className="px-3 py-2 rounded-full text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
            title="Edit selected project"
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmProjectDelete(true)}
            className="px-3 py-2 rounded-full text-sm font-semibold border border-coral/20 text-coral hover:bg-coral/10 transition-colors"
            title="Archive selected project"
          >
            Archive
          </button>
          <button
            onClick={() => showProjectForm ? resetProjectForm() : openCreateProject()}
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

      {archivedProjects.length > 0 && (
        <details className="card mb-4 p-4">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Archived projects ({archivedProjects.length})</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {archivedProjects.map((project) => <button key={project.id} onClick={() => restoreProject(project)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-text-secondary hover:text-mint">Restore {project.name}</button>)}
          </div>
        </details>
      )}

      {showProjectForm && (
        <form onSubmit={handleSaveProject} className="card p-6 mb-6">
          <div className="mb-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              {editingProjectId ? "Project settings" : "New project"}
            </p>
            <h2 className="text-lg font-bold mt-1">
              {editingProjectId ? `Edit ${selectedProject?.name || "Project"}` : "Create Project"}
            </h2>
          </div>
          <FormExample lines={["Name: PzP Dashboard · Repo: github.com/org/repo", "Description: Internal finance management tool"]} />
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
          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">Project members &amp; roles</label>
            <div className="flex flex-wrap gap-2">
              {developers.map((developer) => {
                const role = projectMemberRoles[developer.id];
                return <div key={developer.id} className={`flex items-center overflow-hidden rounded-full border ${role ? "border-lime/30" : "border-[var(--border)]"}`}>
                  <button type="button" onClick={() => setProjectMemberRoles((current) => { const next = { ...current }; if (next[developer.id]) delete next[developer.id]; else next[developer.id] = "MEMBER"; return next; })} className="px-3 py-1.5 text-xs text-text-secondary">{developer.name}</button>
                  {role && <button type="button" onClick={() => setProjectMemberRoles((current) => ({ ...current, [developer.id]: role === "MEMBER" ? "VIEWER" : role === "VIEWER" ? "LEAD" : "MEMBER" }))} className="border-l border-[var(--border)] bg-lime/5 px-2 py-1.5 font-mono text-[9px] text-lime">{role}</button>}
                </div>;
              })}
            </div>
            <p className="mt-2 text-[10px] text-text-tertiary">Leads manage projects; members edit tasks; viewers have read-only access. The creator is always added as lead.</p>
          </div>
          <button
            type="submit"
            disabled={projSubmitting || !projName.trim() || !projDesc.trim()}
            className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
          >
            {projSubmitting
              ? editingProjectId ? "Saving..." : "Creating..."
              : editingProjectId ? "Save Project" : "Create Project"}
          </button>
          <button
            type="button"
            onClick={resetProjectForm}
            className="ml-3 px-4 py-2.5 rounded-full text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card p-6 mb-6">
          <FormExample lines={["Title: Implement dark mode toggle", "Priority: HIGH · Assignee: pick from members", "Tags: frontend, UI"]} />
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
              <Dropdown
                value={formPriority}
                options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
                onChange={setFormPriority}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Status / Column
              </label>
              <Dropdown
                value={formStatus}
                options={COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
                onChange={setFormStatus}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-2">
                Assignee
              </label>
              <Dropdown
                value={formAssignee}
                options={[{ value: "", label: "Unassigned" }, ...(selectedProject?.members.map((m) => ({ value: m.id, label: m.name, avatar: m.photoUrl ?? null })) || [])]}
                onChange={setFormAssignee}
                placeholder="Unassigned"
              />
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
              <Dropdown
                value={formParentId}
                options={[{ value: "", label: "None (top-level task)" }, ...tasks.map((t) => ({ value: t.id, label: t.title }))]}
                onChange={setFormParentId}
                placeholder="None (top-level task)"
              />
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
        <div data-tour="kanban-board" className="grid grid-cols-1 lg:grid-cols-5 gap-4">
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
                        canChangeStatus={canManage(task)}
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
                      canChangeStatus={canManage(task)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task Detail Overlay */}
      {editingTask && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeEdit} />
          <div
            className="relative w-full max-w-2xl max-h-[90vh] max-h-[90dvh] flex flex-col rounded-2xl border border-[var(--border)] overflow-hidden"
            style={{ background: "var(--bg-surface)" }}
          >
            {/* ── Header bar ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0" style={{ background: "var(--bg-deep)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`font-mono text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded ${PRIORITY_COLOR[editingTask.priority]} ${PRIORITY_BG[editingTask.priority]}`}>
                  {editingTask.priority}
                </span>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded"
                  style={{
                    color: `var(--${editingTask.status === "DONE" ? "mint" : editingTask.status === "IN_PROGRESS" ? "amber" : editingTask.status === "REVIEW" ? "violet" : "text-secondary"})`,
                    background: `var(--${editingTask.status === "DONE" ? "mint" : editingTask.status === "IN_PROGRESS" ? "amber" : editingTask.status === "REVIEW" ? "violet" : "text-secondary"}, rgba(255,255,255,0.1))`,
                    backgroundColor: editingTask.status === "DONE" ? "rgba(52,211,153,0.12)" : editingTask.status === "IN_PROGRESS" ? "rgba(251,191,36,0.12)" : editingTask.status === "REVIEW" ? "rgba(167,139,250,0.12)" : "rgba(228,228,232,0.08)",
                  }}
                >
                  {editingTask.status.replace(/_/g, " ")}
                </span>
                {editingTask.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
                    style={{ backgroundColor: tag.color + "25", color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
              <button
                onClick={closeEdit}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-6">
              {/* Title + description (read view) */}
              <div>
                <h2 className="text-xl font-bold leading-snug mb-2">{editingTask.title}</h2>
                {editingTask.description && (
                  <p className="text-sm text-text-secondary leading-relaxed">{editingTask.description}</p>
                )}
              </div>

              {/* Metadata row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {editingTask.assignee && (
                  <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-deep)" }}>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Assignee</span>
                    <TgUser name={editingTask.assignee.name} photoUrl={editingTask.assignee.photoUrl} size={22} />
                  </div>
                )}
                {editingTask.deadline && (
                  <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-deep)" }}>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary block mb-1">Deadline</span>
                    <span className="text-sm text-text-primary font-medium">{new Date(editingTask.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>
                )}
                <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-deep)" }}>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary block mb-1">Priority</span>
                  <span className={`text-sm font-medium ${PRIORITY_COLOR[editingTask.priority]}`}>{editingTask.priority}</span>
                </div>
              </div>

              {/* Subtasks */}
              {editingTask.subtasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Subtasks</span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {editingTask.subtasks.filter((s) => s.status === "DONE").length}/{editingTask.subtasks.length} done
                    </span>
                    {/* Progress bar */}
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-deep)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(editingTask.subtasks.filter((s) => s.status === "DONE").length / editingTask.subtasks.length) * 100}%`,
                          background: "var(--mint)",
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {editingTask.subtasks.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2"
                        style={{ background: "var(--bg-deep)" }}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${sub.status === "DONE" ? "bg-mint" : sub.status === "IN_PROGRESS" ? "bg-amber" : "bg-text-tertiary"}`} />
                        <span className={`text-sm flex-1 ${sub.status === "DONE" ? "text-text-tertiary line-through" : "text-text-secondary"}`}>
                          {sub.title}
                        </span>
                        {sub.tags.map((tag) => (
                          <span key={tag.id} className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0" style={{ backgroundColor: tag.color + "25", color: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                        <span className={`font-mono text-[9px] uppercase tracking-[0.08em] shrink-0 ${COLUMN_ACCENT[sub.status] || "text-text-tertiary"}`}>
                          {sub.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Edit form: admins and the task's owner (assignee or creator) ── */}
              {canManage(editingTask) ? (
                <div className="border-t border-[var(--border)] pt-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-4">Edit Task</span>
                  <form onSubmit={handleSaveEdit} className="space-y-4">
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        required
                        className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Description</label>
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={2}
                        className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Status</label>
                        <Dropdown value={editStatus} options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} onChange={setEditStatus} />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Priority</label>
                        <Dropdown value={editPriority} options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))} onChange={setEditPriority} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Assignee</label>
                        <Dropdown
                          value={editAssignee}
                          options={[{ value: "", label: "Unassigned" }, ...(selectedProject?.members.map((m) => ({ value: m.id, label: m.name, avatar: m.photoUrl ?? null })) || [])]}
                          onChange={setEditAssignee}
                          placeholder="Unassigned"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Deadline</label>
                        <input
                          type="date"
                          value={editDeadline}
                          onChange={(e) => setEditDeadline(e.target.value)}
                          className="w-full bg-bg-deep border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-lime/30"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Parent Task</label>
                      <Dropdown
                        value={editParentId}
                        options={[{ value: "", label: "None (top-level)" }, ...tasks.filter((t) => t.id !== editingTask.id).map((t) => ({ value: t.id, label: t.title }))]}
                        onChange={setEditParentId}
                        placeholder="None (top-level)"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary block mb-1.5">Tags</label>
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const isSelected = editTags.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleEditTag(tag.id)}
                              className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
                              style={{
                                backgroundColor: isSelected ? tag.color + "30" : "transparent",
                                borderColor: isSelected ? tag.color : "var(--border)",
                                color: isSelected ? tag.color : "var(--text-secondary)",
                              }}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </form>
                </div>
              ) : (
                /* ── Read-only detail for tasks that aren't yours ── */
                <div className="border-t border-[var(--border)] pt-5">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
                    Status: <span className={COLUMN_ACCENT[editingTask.status] || "text-text-secondary"}>{editingTask.status.replace(/_/g, " ")}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Sticky footer — only when there's an action the user is allowed to take ── */}
            {(canManage(editingTask) || canDelete(editingTask)) && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] shrink-0" style={{ background: "var(--bg-deep)" }}>
              {canManage(editingTask) ? (
                <button
                  onClick={(e) => { e.preventDefault(); handleSaveEdit(e as unknown as React.FormEvent); }}
                  disabled={saving || !editTitle.trim()}
                  className="bg-lime text-bg-void font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-lime/90 disabled:opacity-40 transition-colors"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              ) : (
                <span />
              )}
              {canDelete(editingTask) && (
                !confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-4 py-2 rounded-full text-xs font-semibold text-coral bg-coral/10 hover:bg-coral/20 transition-colors"
                  >
                    Delete Task
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary">
                      {editingTask.subtasks.length > 0
                        ? `Delete with ${editingTask.subtasks.length} subtask${editingTask.subtasks.length !== 1 ? "s" : ""}?`
                        : "Sure?"}
                    </span>
                    <button
                      onClick={handleDeleteTask}
                      disabled={deleting}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-coral/20 text-coral hover:bg-coral/30 disabled:opacity-40 transition-colors"
                    >
                      {deleting ? "..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-text-tertiary text-xs hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )
              )}
            </div>
            )}
          </div>
        </div>,
        document.body,
      )}
      </div>
      {/* Mobile Git Feed — shown below kanban on small screens */}
      <div className="block lg:hidden mt-4">
        {activityPanel}
      </div>
      {/* Desktop Git Feed — sticky sidebar */}
      <div className="hidden lg:block shrink-0 sticky top-4">{activityPanel}</div>
      <PageTour pageKey="dev-board" />
      </div>
    </>
  );
}

function TaskCard({
  task,
  onStatusChange,
  onEdit,
  expanded,
  onToggleExpand,
  canChangeStatus,
}: {
  task: Task;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (task: Task) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  canChangeStatus: boolean;
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
        <div className="mb-2">
          <TgUser name={task.assignee.name} photoUrl={task.assignee.photoUrl} size={20} />
        </div>
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

      {canChangeStatus ? (
        <Dropdown
          value={task.status}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
          onChange={(val) => onStatusChange(task.id, val)}
          onClick={(e) => e.stopPropagation()}
          size="sm"
        />
      ) : (
        <span
          className={`inline-block font-mono text-[9px] uppercase tracking-[0.08em] ${COLUMN_ACCENT[task.status] || "text-text-tertiary"}`}
        >
          {task.status.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}
