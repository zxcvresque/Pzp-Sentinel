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
    body: "Board and My Tasks keep project work focused, while Services groups VPS access and shared credentials in one place.",
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

  "admin-donors": [
    {
      target: "[data-tour='donor-payment-access']",
      title: "Donor Payment Access",
      body: "BMC is available by default. Enable Razorpay for selected donors; it stays available until an administrator switches it off.",
      placement: "bottom",
    },
    {
      target: "[data-tour='guest-payment-links']",
      title: "One-time Guest Links",
      body: "Create a Telegram bot link for a one-time payer. The bot captures the sender's Telegram identity before revealing checkout.",
      placement: "bottom",
    },
    {
      target: "[data-tour='razorpay-donation']",
      title: "Razorpay Checkout",
      body: "Razorpay uses whichever live or test key is configured on the server. Captures are verified server-side and recorded automatically.",
      placement: "bottom",
    },
    {
      target: "[data-tour='bmc-support']",
      title: "Buy Me a Coffee",
      body: "The embedded BMC checkout remains webhook-tracked for payments, refunds, extras, memberships, commissions, and wishlist activity.",
      placement: "bottom",
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
      title: "Store & Share Credentials",
      body: "Add API keys, passwords, or tokens. For each developer you share with, you pick an access level — there's no default, you choose every time.",
      placement: "bottom",
    },
    {
      target: "[data-tour='credential-list']",
      title: "Public-key vs Full Access",
      body: "Public-key: the dev submits their own SSH key, you install it and flip Grant — they never see the secret. Full: the dev can reveal the actual value. VPS server secrets appear here automatically, linked to the server.",
      placement: "top",
    },
  ],

  "admin-vps": [
    {
      target: "[data-tour='admin-vps-title']",
      title: "How Devs Get Access",
      body: "By default every dev sees server stats but no credentials. A dev requests SSH access by submitting their public key; you install it on the box and grant them from the Credential Vault. Revealing the password/private key (Full access) is opt-in, per dev.",
      placement: "bottom",
    },
    {
      target: "[data-tour='add-server']",
      title: "Add a Server",
      body: "When you add a server, its password and SSH key are encrypted and mirrored into the Credential Vault automatically. You can also set a Plan Link and a Duration (Lifetime or a subscription) and grant full credential access to specific devs — all right here at creation.",
      placement: "bottom",
    },
    {
      target: "[data-tour='vps-edit']",
      title: "Plan, Duration & Billing",
      body: "Edit any server to add its Plan Link and Duration. Saving with a price deducts it from your current balance now and adds a row to the Services tab. Pick Subscription + Auto-renew to bill every cycle automatically, or use \"Renew now\" to log one manually. Plan and billing are admin-only — never shown to or shared with devs.",
      placement: "bottom",
    },
  ],

  /* ── Dev pages ── */
  "dev-vps": [
    {
      target: "[data-tour='dev-vps-title']",
      title: "Stats Are Open to You",
      body: "You can see live stats for every approved server. Credentials and SSH access, though, stay private until an admin grants them.",
      placement: "bottom",
    },
    {
      target: "[data-tour='ssh-access']",
      title: "Request SSH Access",
      body: "On a server, paste your own SSH public key to request access. An admin installs it on the box and grants you in — the server password and private key are never shared. Once granted, you'll see the key you submitted here for reference.",
      placement: "top",
    },
  ],

  "dev-credentials": [
    {
      target: "[data-tour='dev-creds-title']",
      title: "Shared With You Only",
      body: "This page stays empty until an admin shares a credential with you. Full-access ones can be revealed here; public-key ones show only the SSH key you submitted — never the secret itself.",
      placement: "bottom",
    },
    {
      target: "[data-tour='share-new']",
      title: "Share Something You Own",
      body: "Have a credential the team needs? Submit it here and an admin will review before it goes live.",
      placement: "bottom",
    },
  ],

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

  /* ── Donor page ── */
  "donor-overview": [
    {
      target: "[data-tour='razorpay-donation']",
      title: "Pay Securely",
      body: "Donate inside Sentinel with Razorpay. UPI, QR, cards, and netbanking appear according to the payment methods enabled on the account.",
      placement: "bottom",
    },
    {
      target: "[data-tour='bmc-support']",
      title: "Support with BMC",
      body: "Prefer Buy Me a Coffee? Open its hosted checkout here; successful payments return to Sentinel automatically through the verified webhook.",
      placement: "bottom",
    },
    {
      target: "[data-tour='donor-stats']",
      title: "Your Contributions",
      body: "Total contributed, pending submissions, and approved donations — your giving history at a glance.",
      placement: "bottom",
    },
    {
      target: "[data-tour='new-donation']",
      title: "Submit a Donation",
      body: "Already paid elsewhere? Record that contribution with an optional proof screenshot for admin review.",
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
