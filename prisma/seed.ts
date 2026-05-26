import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  // --- Clean up all tables ---
  await prisma.credential.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.service.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.tag.deleteMany();

  // --- Users ---
  const varad = await prisma.user.upsert({
    where: { telegramId: "1800754304" },
    update: { roles: ["ADMIN", "DONOR", "DEV"] },
    create: {
      telegramId: "1800754304",
      telegramUser: "varad",
      name: "Varad",
      roles: ["ADMIN", "DONOR", "DEV"],
    },
  });
  console.log("Users seeded: Varad");

  // --- Tags ---
  const tagData = [
    { name: "Backend",  color: "#6366f1" },
    { name: "Frontend", color: "#f472b6" },
    { name: "Bug",      color: "#ef4444" },
    { name: "Feature",  color: "#22d3ee" },
    { name: "DevOps",   color: "#f59e0b" },
    { name: "UI/UX",    color: "#a78bfa" },
    { name: "Security", color: "#f43f5e" },
    { name: "Docs",     color: "#34d399" },
  ];

  const tags: Record<string, string> = {};
  for (const t of tagData) {
    const tag = await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: t,
    });
    tags[t.name] = tag.id;
  }
  console.log("Tags seeded:", tagData.length);

  // --- Projects ---
  const sentinel = await prisma.project.create({
    data: {
      name: "PzP Sentinel",
      description: "Finance dashboard & team management platform for the PzP community",
      repoUrl: "https://github.com/pzp-finance/sentinel",
      members: { connect: [{ id: varad.id }] },
    },
  });

  const botProject = await prisma.project.create({
    data: {
      name: "Sentinel Bot",
      description: "Telegram bot for authentication, notifications, and community interaction",
      repoUrl: "https://github.com/pzp-finance/sentinel-bot",
      members: { connect: [{ id: varad.id }] },
    },
  });

  const infraProject = await prisma.project.create({
    data: {
      name: "Infrastructure",
      description: "VPS management, CI/CD pipelines, monitoring agents, and deployment scripts",
      members: { connect: [{ id: varad.id }] },
    },
  });
  console.log("Projects seeded: 3");

  // --- Sentinel Tasks ---

  // DONE tasks
  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Transaction detail modal with receipt photos",
      description: "Full-screen overlay showing donor info, amounts, review status, and uploaded receipt images with lightbox.",
      status: "DONE",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-21),
      deadline: daysFromNow(-14),
      tags: { connect: [{ id: tags["Frontend"] }, { id: tags["Feature"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Notification click navigation",
      description: "Map all 9 NotifType values to appropriate dashboard routes so clicking a notification navigates somewhere useful.",
      status: "DONE",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-10),
      deadline: daysFromNow(-7),
      tags: { connect: [{ id: tags["Frontend"] }, { id: tags["Bug"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Merge Services & Subscriptions into single page",
      description: "Consolidate the redundant Services and Subscriptions panels into a unified Service Catalog with optional cost tracking.",
      status: "DONE",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-8),
      deadline: daysFromNow(-3),
      tags: { connect: [{ id: tags["Backend"] }, { id: tags["Frontend"] }] },
    },
  });

  // IN_PROGRESS tasks
  const githubIntegration = await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "GitHub integration for Dev portal",
      description: "Link PRs to tasks, show PR status on task cards, auto-move tasks on merge. The last remaining feature on the roadmap.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-2),
      deadline: daysFromNow(12),
      tags: { connect: [{ id: tags["Feature"] }, { id: tags["Backend"] }] },
    },
  });

  // Subtasks for GitHub integration
  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "GitHub OAuth app setup & token storage",
      status: "DONE",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: githubIntegration.id,
      tags: { connect: [{ id: tags["Backend"] }, { id: tags["Security"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Webhook listener for PR events",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: githubIntegration.id,
      tags: { connect: [{ id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "PR badge on task cards + link-back UI",
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: githubIntegration.id,
      tags: { connect: [{ id: tags["Frontend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Auto-move task to REVIEW on PR open",
      status: "BACKLOG",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: githubIntegration.id,
      tags: { connect: [{ id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Currency toggle on dashboard stats",
      description: "Add INR/USD toggle on the admin dashboard that converts all amounts using the live exchange rate API.",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-1),
      deadline: daysFromNow(3),
      tags: { connect: [{ id: tags["Frontend"] }, { id: tags["Feature"] }] },
    },
  });

  // REVIEW tasks
  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Donor leaderboard with anonymous option",
      description: "Public leaderboard showing top donors with opt-in anonymity toggle. Cards show total donated, last donation date.",
      status: "REVIEW",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-7),
      deadline: daysFromNow(1),
      tags: { connect: [{ id: tags["Frontend"] }, { id: tags["Feature"] }] },
    },
  });

  // TODO tasks
  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Export transactions to CSV/PDF",
      description: "Admin should be able to export filtered transaction data as CSV or generate a PDF report for record keeping.",
      status: "TODO",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(14),
      tags: { connect: [{ id: tags["Feature"] }, { id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Dark mode color fine-tuning for receipt photos",
      description: "Receipt images have low contrast on the dark background. Add a subtle brightness filter or light-background container.",
      status: "TODO",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(7),
      tags: { connect: [{ id: tags["UI/UX"] }, { id: tags["Bug"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Service expiry alerts via Telegram DM",
      description: "Auto-send DM to admins 7/3/1 days before a tracked service expires. Use the existing reminder cron.",
      status: "TODO",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(5),
      tags: { connect: [{ id: tags["Backend"] }, { id: tags["Feature"] }] },
    },
  });

  // BACKLOG tasks
  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Audit log search & filtering",
      description: "Audit log page currently shows everything. Add filters by action type, user, entity type, and date range.",
      status: "BACKLOG",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      tags: { connect: [{ id: tags["Frontend"] }, { id: tags["Feature"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: sentinel.id,
      title: "Mobile-responsive Gantt chart",
      description: "Gantt timeline is unusable on phones. Either collapse to a simplified list view or add pinch-zoom.",
      status: "BACKLOG",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      tags: { connect: [{ id: tags["UI/UX"] }, { id: tags["Frontend"] }] },
    },
  });

  // --- Bot Tasks ---

  const botRewrite = await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Refactor bot command handlers into modules",
      description: "bot-dev.ts is getting long. Split /start, /help, and my_chat_member into separate handler files.",
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(10),
      tags: { connect: [{ id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Extract auth handler to handlers/auth.ts",
      status: "BACKLOG",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: botRewrite.id,
      tags: { connect: [{ id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Extract chat_member handler",
      status: "BACKLOG",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      parentId: botRewrite.id,
      tags: { connect: [{ id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Inline donation submission via bot",
      description: "Allow donors to submit donations directly in the Telegram chat with /donate command instead of opening the web app.",
      status: "BACKLOG",
      priority: "LOW",
      assigneeId: varad.id,
      createdById: varad.id,
      tags: { connect: [{ id: tags["Feature"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Bot /status command for quick treasury summary",
      description: "Reply with balance, pending count, and last transaction date. Available to all roles.",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-3),
      deadline: daysFromNow(2),
      tags: { connect: [{ id: tags["Feature"] }, { id: tags["Backend"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: botProject.id,
      title: "Rate-limit bot commands to prevent spam",
      description: "Add per-user rate limiting (e.g., 5 commands/min) using Grammy middleware.",
      status: "TODO",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(4),
      tags: { connect: [{ id: tags["Security"] }, { id: tags["Backend"] }] },
    },
  });

  // --- Infra Tasks ---

  await prisma.task.create({
    data: {
      projectId: infraProject.id,
      title: "VPS monitoring agent auto-install script",
      description: "One-liner curl | bash script that installs the node agent, registers with Sentinel API, and sets up systemd service.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      startDate: daysFromNow(-5),
      deadline: daysFromNow(2),
      tags: { connect: [{ id: tags["DevOps"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: infraProject.id,
      title: "Set up GitHub Actions CI for Sentinel",
      description: "Lint, type-check, and build on every PR. Deploy to staging on merge to main.",
      status: "TODO",
      priority: "HIGH",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(7),
      tags: { connect: [{ id: tags["DevOps"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: infraProject.id,
      title: "Automated database backups to S3",
      description: "Daily pg_dump to an S3 bucket with 30-day retention. Alert on failure.",
      status: "BACKLOG",
      priority: "CRITICAL",
      assigneeId: varad.id,
      createdById: varad.id,
      tags: { connect: [{ id: tags["DevOps"] }, { id: tags["Security"] }] },
    },
  });

  await prisma.task.create({
    data: {
      projectId: infraProject.id,
      title: "Document deployment runbook",
      description: "Step-by-step guide covering env setup, database migration, bot deployment, and rollback procedures.",
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: varad.id,
      createdById: varad.id,
      deadline: daysFromNow(14),
      tags: { connect: [{ id: tags["Docs"] }] },
    },
  });

  // --- VPS Servers (approved, with realistic metrics) ---
  await prisma.vpsServer.create({
    data: {
      name: "sentinel-prod",
      token: "tok_sentinel_prod_" + Date.now(),
      provider: "Varad",
      ip: "152.67.4.128",
      platform: "Oracle Cloud",
      password: "",
      notes: "Main production server — runs Next.js app + bot process",
      specs: { CPU: "2 vCPU", RAM: "12 GB", Disk: "50 GB", OS: "Ubuntu 22.04" },
      cpuUsage: 23,
      ramUsage: 4.2,
      ramTotal: 12,
      diskUsage: 18.6,
      diskTotal: 50,
      netIn: 12.4,
      netOut: 3.8,
      uptime: 1296000, // 15 days
      loadAvg: "0.52, 0.38, 0.25",
      status: "online",
      approved: true,
    },
  });

  await prisma.vpsServer.create({
    data: {
      name: "sentinel-staging",
      token: "tok_sentinel_staging_" + Date.now(),
      provider: "Varad",
      ip: "89.58.16.42",
      platform: "Netcup",
      password: "",
      notes: "Staging/test environment — mirrors prod config",
      specs: { CPU: "2 vCPU", RAM: "4 GB", Disk: "40 GB", OS: "Ubuntu 24.04" },
      cpuUsage: 8,
      ramUsage: 1.3,
      ramTotal: 4,
      diskUsage: 6.1,
      diskTotal: 40,
      netIn: 1.2,
      netOut: 0.4,
      uptime: 604800, // 7 days
      loadAvg: "0.12, 0.08, 0.05",
      status: "online",
      approved: true,
    },
  });

  await prisma.vpsServer.create({
    data: {
      name: "bot-worker",
      token: "tok_bot_worker_" + Date.now(),
      provider: "Community",
      ip: "45.132.75.91",
      platform: "Hetzner",
      password: "",
      notes: "Dedicated to cron jobs: reminders, expiry checks, BMC polling",
      specs: { CPU: "1 vCPU", RAM: "2 GB", Disk: "20 GB", OS: "Debian 12" },
      cpuUsage: 62,
      ramUsage: 1.6,
      ramTotal: 2,
      diskUsage: 8.4,
      diskTotal: 20,
      netIn: 0.3,
      netOut: 0.1,
      uptime: 259200, // 3 days
      loadAvg: "0.88, 0.72, 0.61",
      status: "online",
      approved: true,
    },
  });

  console.log("VPS servers seeded: 3");

  // --- Services with cost tracking ---
  await prisma.service.create({
    data: {
      category: "Infrastructure",
      name: "Supabase",
      columns: [
        { key: "tier", label: "Tier", type: "text" },
        { key: "region", label: "Region", type: "text" },
      ],
      entries: [
        { tier: "Pro", region: "ap-south-1" },
      ],
      price: 25,
      currency: "USD",
      frequency: "MONTHLY",
      planUrl: "https://supabase.com/pricing",
      expiryDate: daysFromNow(35),
      status: "ACTIVE",
    },
  });

  await prisma.service.create({
    data: {
      category: "Infrastructure",
      name: "Vercel Pro",
      columns: [
        { key: "project", label: "Project", type: "text" },
        { key: "framework", label: "Framework", type: "text" },
      ],
      entries: [
        { project: "sentinel-web", framework: "Next.js 15" },
      ],
      price: 20,
      currency: "USD",
      frequency: "MONTHLY",
      planUrl: "https://vercel.com/pricing",
      expiryDate: daysFromNow(28),
      status: "ACTIVE",
    },
  });

  await prisma.service.create({
    data: {
      category: "Infrastructure",
      name: "Cloudflare",
      columns: [
        { key: "plan", label: "Plan", type: "text" },
        { key: "domain", label: "Domain", type: "text" },
      ],
      entries: [
        { plan: "Free", domain: "pzp.finance" },
      ],
    },
  });

  await prisma.service.create({
    data: {
      category: "DevTools",
      name: "GitHub Pro",
      price: 4,
      currency: "USD",
      frequency: "MONTHLY",
      planUrl: "https://github.com/pricing",
      status: "ACTIVE",
    },
  });

  await prisma.service.create({
    data: {
      category: "DevTools",
      name: "Sentry",
      columns: [
        { key: "plan", label: "Plan", type: "text" },
        { key: "events", label: "Events/mo", type: "text" },
      ],
      entries: [
        { plan: "Developer", events: "5,000" },
      ],
    },
  });

  await prisma.service.create({
    data: {
      category: "Communication",
      name: "Telegram Bot API",
      columns: [
        { key: "bot", label: "Bot", type: "text" },
        { key: "mode", label: "Mode", type: "text" },
      ],
      entries: [
        { bot: "@SentinelPzPBot", mode: "Polling" },
      ],
    },
  });

  console.log("Services seeded: 6");
  console.log("\nSeed complete. Dev portal is loaded with test data.");
}

main()
  .then(() => { prisma.$disconnect(); pool.end(); })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    pool.end();
    process.exit(1);
  });
