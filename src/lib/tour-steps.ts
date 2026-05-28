import type { TourStep } from "@/components/SpotlightTour";

/* ------------------------------------------------------------------ */
/*  Tour steps per role                                                */
/* ------------------------------------------------------------------ */

export const adminTourSteps: TourStep[] = [
  {
    target: "[data-tour='brand']",
    title: "Welcome to Sentinel",
    body: "This is your finance & team management hub. Everything PzP runs through here — treasury, tasks, team, and more.",
    placement: "right",
  },
  {
    target: "[data-tour='role-tabs']",
    title: "Switch Roles",
    body: "You have multiple roles — Admin, Dev, and Donor views each have their own dashboard. On desktop use the sidebar tabs; on mobile tap More (bottom right) → Switch View.",
    placement: "right",
  },
  {
    target: "[data-tour='nav']",
    title: "Navigation",
    body: "All your pages are here. Dashboard for the overview, Transactions for the treasury, Users to manage the team, and more.",
    placement: "right",
  },
  {
    target: "[data-tour='breadcrumb']",
    title: "Where You Are",
    body: "This breadcrumb always shows your current location. It updates as you navigate between pages.",
    placement: "bottom",
  },
  {
    target: "[data-tour='notifications']",
    title: "Notifications",
    body: "Transaction approvals, new user signups, task assignments — all your alerts land here. The badge shows unread count.",
    placement: "bottom",
  },
  {
    target: "[data-tour='profile']",
    title: "Your Profile",
    body: "Access settings, change your theme color, or sign out. Click your avatar anytime to open this menu.",
    placement: "bottom",
  },
];

export const devTourSteps: TourStep[] = [
  {
    target: "[data-tour='brand']",
    title: "Welcome to Sentinel",
    body: "This is your project management hub. Track tasks, manage sprints, and stay in sync with the team.",
    placement: "right",
  },
  {
    target: "[data-tour='nav']",
    title: "Your Workspace",
    body: "Board for projects, My Tasks for your assignments, Gantt for timelines, and Credentials for shared access keys.",
    placement: "right",
  },
  {
    target: "[data-tour='breadcrumb']",
    title: "Where You Are",
    body: "This breadcrumb shows your current page. It updates automatically as you navigate.",
    placement: "bottom",
  },
  {
    target: "[data-tour='notifications']",
    title: "Stay Updated",
    body: "Task assignments, deadline reminders, and project updates all show up here.",
    placement: "bottom",
  },
  {
    target: "[data-tour='profile']",
    title: "Your Profile",
    body: "Settings, theme customization, and sign out are all here.",
    placement: "bottom",
  },
];

export const donorTourSteps: TourStep[] = [
  {
    target: "[data-tour='brand']",
    title: "Welcome to Sentinel",
    body: "Thanks for supporting PzP! This is where you can track your donations and see how funds are being used.",
    placement: "right",
  },
  {
    target: "[data-tour='nav']",
    title: "Your Dashboard",
    body: "My Donations shows your contribution history and stats at a glance.",
    placement: "right",
  },
  {
    target: "[data-tour='notifications']",
    title: "Donation Updates",
    body: "When your donations are approved or receipts are ready, you'll get notified here.",
    placement: "bottom",
  },
  {
    target: "[data-tour='profile']",
    title: "Your Profile",
    body: "Manage your settings and personalize your theme color.",
    placement: "bottom",
  },
];

export function getTourSteps(role: string): TourStep[] {
  switch (role) {
    case "ADMIN":
      return adminTourSteps;
    case "DEV":
      return devTourSteps;
    case "DONOR":
      return donorTourSteps;
    default:
      return devTourSteps;
  }
}

/* ------------------------------------------------------------------ */
/*  Page-specific mini tours                                           */
/* ------------------------------------------------------------------ */

export const pageTourSteps: Record<string, TourStep[]> = {
  /* ── Admin pages ── */
  "admin-dashboard": [
    {
      target: "[data-tour='currency-toggle']",
      title: "Currency Toggle",
      body: "Switch between INR and USD. All figures on this page update instantly, including stats and charts.",
      placement: "bottom",
    },
    {
      target: "[data-tour='stat-cards']",
      title: "Financial Snapshot",
      body: "Your treasury at a glance — balance, donations, spend, burn rate, recurring costs, and pending approvals.",
      placement: "bottom",
    },
    {
      target: "[data-tour='recent-transactions']",
      title: "Recent Activity",
      body: "The latest 10 transactions appear here. For the full list with filters and actions, visit Transactions.",
      placement: "top",
    },
  ],

  "admin-transactions": [
    {
      target: "[data-tour='log-transaction']",
      title: "Log a Transaction",
      body: "Record incoming donations or outgoing expenses. Fill in amount, method, and description to create a new entry.",
      placement: "bottom",
    },
    {
      target: "[data-tour='tx-filters']",
      title: "Filter & Sort",
      body: "Narrow down by status (Pending, Approved, Rejected) or direction (In, Out). Click a row for full details.",
      placement: "bottom",
    },
  ],

  "admin-users": [
    {
      target: "[data-tour='add-user']",
      title: "Add Team Members",
      body: "Invite users by their Telegram ID. Assign them Admin, Dev, or Donor roles to control access.",
      placement: "bottom",
    },
    {
      target: "[data-tour='users-table']",
      title: "Manage Members",
      body: "Edit roles, deactivate accounts, or remove users. Bot status shows if they've connected via Telegram.",
      placement: "top",
    },
  ],

  "admin-services": [
    {
      target: "[data-tour='service-stats']",
      title: "Subscription Overview",
      body: "Active subscriptions, monthly burn, and total services — a quick snapshot of your recurring costs.",
      placement: "bottom",
    },
    {
      target: "[data-tour='service-catalog']",
      title: "Service Catalog",
      body: "Services are grouped by category. Each card shows cost, status, and custom data columns you define.",
      placement: "top",
    },
  ],

  "admin-credentials": [
    {
      target: "[data-tour='add-credential']",
      title: "Store Credentials",
      body: "Add API keys, passwords, or access tokens. Assign them to specific developers so they can see only what they need.",
      placement: "bottom",
    },
    {
      target: "[data-tour='credential-list']",
      title: "Credential Vault",
      body: "Values are hidden by default. Click Reveal to view them. Edits go through a pending review before applying.",
      placement: "top",
    },
  ],

  /* ── Dev pages ── */
  "dev-board": [
    {
      target: "[data-tour='board-actions']",
      title: "Projects & Tasks",
      body: "Create projects to organize work, then add tasks with priorities, tags, and assignees.",
      placement: "bottom",
    },
    {
      target: "[data-tour='kanban-board']",
      title: "Kanban Board",
      body: "Tasks are grouped by status columns: Backlog, To Do, In Progress, Review, and Done. Click any card for details.",
      placement: "top",
    },
    {
      target: "[data-tour='activity-panel']",
      title: "Git Feed",
      body: "Recent GitHub activity from your organization — pushes, PRs, branches, and releases streamed in real-time.",
      placement: "left",
    },
  ],

  "dev-tasks": [
    {
      target: "[data-tour='task-summary']",
      title: "Your Task Summary",
      body: "A quick count of total tasks, in-progress, and overdue items assigned to you.",
      placement: "bottom",
    },
    {
      target: "[data-tour='task-filters']",
      title: "Filter & Group",
      body: "Group by status or tag, filter by priority level. Helps you focus on what matters most right now.",
      placement: "bottom",
    },
  ],

  "dev-gantt": [
    {
      target: "[data-tour='gantt-header']",
      title: "Gantt Timeline",
      body: "Visualize task timelines across projects. The dashed line marks today. Filter by project to focus.",
      placement: "bottom",
    },
    {
      target: "[data-tour='gantt-chart']",
      title: "Reading the Chart",
      body: "Bars represent task duration. Color indicates status, border thickness shows priority. Hover for details.",
      placement: "top",
    },
  ],

  /* ── Donor page ── */
  "donor-overview": [
    {
      target: "[data-tour='donor-stats']",
      title: "Your Contributions",
      body: "Total contributed, pending submissions, and approved donations — your giving history at a glance.",
      placement: "bottom",
    },
    {
      target: "[data-tour='new-donation']",
      title: "Submit a Donation",
      body: "Record your contribution with amount, method, and optional proof screenshots. An admin will review it.",
      placement: "bottom",
    },
    {
      target: "[data-tour='donation-history']",
      title: "Donation History",
      body: "All your submissions with status badges. Filter by Pending, Approved, or Rejected.",
      placement: "top",
    },
  ],
};

export function getPageTourSteps(pageKey: string): TourStep[] {
  return pageTourSteps[pageKey] || [];
}
