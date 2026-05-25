<p align="center">
  <img src="public/banner.png" alt="Sentinel Banner" width="100%" />
</p>

<h1 align="center">Ｓ ☰ ＮＴＩＮ ☰ Ｌ</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-336791?style=flat-square&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?style=flat-square&logo=telegram&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/License-Private-gray?style=flat-square" />
</p>

<p align="center">
  Community treasury management and developer collaboration platform for the PzP developer community.<br/>
  Built as a Telegram Mini App with role-based access, real-time monitoring, and immutable audit logging.
</p>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript 5 |
| ORM | Prisma 7 (driver adapters, `@prisma/adapter-pg` + `pg`) |
| Database | PostgreSQL (Supabase) |
| Bot | grammY (Telegram Bot framework, polling mode) |
| Auth | jose (JWT, Edge-compatible), Telegram Login Widget |
| Theme | Glassmorphism dark theme (`#111116` base, `#6FD1D7` default accent) |

---

## Roles

Sentinel uses three roles with distinct navigation, theming, and permissions.

| Role | Theme | Nav Pages |
|------|-------|-----------|
| **ADMIN** | Violet | Dashboard, Transactions, Services, Subscriptions, Donors, Users, Reminders, Credentials, VPS Stats, Audit Log |
| **DEV** | Cyan | Board, My Tasks, Gantt, VPS Stats, Credentials |
| **DONOR** | Amber | My Donations |

---

## Features

### `ADMIN` Treasury and Operations

Full financial oversight, platform management, and team coordination.

- Treasury dashboard with real-time balance and multi-currency support (INR/USD with live exchange rate)
- Transaction management with approval/rejection workflow
- Receipt photo viewing for donations
- CSV export for transactions
- Subscription tracking
- Service registry with dynamic columns
- Credential vault with revision history and dev assignment
- User management with role assignment
- Reminders with role-based targeting
- VPS server monitoring (live metrics from bash agent, approval flow for dev-requested servers, 30s refresh)
- Donor leaderboard
- Full audit log

### `DEV` Project Board and Credentials

Kanban workflow with tags, subtasks, Gantt charts, and secure credential access.

- Kanban board with 5 status columns (Backlog, To Do, In Progress, Review, Done)
- Task management with priority, subtasks, deadlines, and tags
- 8 color-coded tags: `Backend` `Frontend` `Bug` `Feature` `DevOps` `UI/UX` `Security` `Docs`
- Gantt chart view
- VPS stats (read-only monitoring + request new servers)
- Credential access with propose/approve workflow

### `DONOR` Contributions

Track donations, upload receipts, and receive appreciation messages.

- My Donations view with status tracking (pending / approved / rejected)
- Submit donations with amount, currency (INR/USD), method (UPI / BMC / Bank / Other), and reference
- Photo receipt upload (max 20 MB per image)
- 3 stat cards: total contributed, pending count, approved count
- Appreciation messages on approval (5 normal + 5 generous thresholds based on average donation)

### Telegram Integration

- Mini App auth via `initData` HMAC-SHA256 validation
- Bot-based login flow (@TheSentinelRobot)
- Group topic logging (audit, transactions, screenshots)
- Configurable DM notifications (9 categories, all ON by default)
- Profile photo sync

### Platform-Wide

- GitHub immutable audit log (Sentinel-Logs repo)
- Buy Me a Coffee webhook integration with auto-sync
- Multi-currency with live USD/INR exchange rate
- Custom accent color with 3 saved preset slots
- Role-based theming (ADMIN violet, DONOR amber, DEV cyan)
- Collapsible sidebar with mobile bottom bar
- In-app notification system

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/zxcvresque/Pzp-Sentinel.git
cd Pzp-Sentinel
npm install

# Configure environment
cp .env.example .env
```

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/sentinel

# Telegram Bot
BOT_TOKEN=your-telegram-bot-token
BOT_USERNAME=TheSentinelRobot
BOT_WEBHOOK_SECRET=your-webhook-secret

# Auth
JWT_SECRET=your-jwt-secret

# App
WEBAPP_URL=https://your-domain.com

# Telegram Group Topics
TG_GROUP_ID=your-group-id
TG_TOPIC_AUDIT=topic-id
TG_TOPIC_TRANSACTIONS=topic-id
TG_TOPIC_SCREENSHOTS=topic-id

# GitHub Audit Logs
GITHUB_LOGS_TOKEN=your-github-pat

# Buy Me a Coffee
BMC_WEBHOOK_SECRET=your-bmc-webhook-secret
BMC_TOKEN=your-bmc-api-token
```

```bash
# Database setup
npx prisma db push
npx prisma generate
npx tsx prisma/seed.ts

# Run (two separate processes)
npm run dev        # Next.js dev server
npm run bot:dev    # Telegram bot
```

### Available Scripts

```
npm run dev          # Next.js dev server
npm run bot:dev      # Telegram bot (separate process)
npm run db:seed      # Seed database
npm run db:push      # Push schema to DB
npm run db:generate  # Generate Prisma client
```

---

## Deployment

Sentinel runs as two processes in production:

1. **Next.js application** -- the web frontend and API routes
2. **Telegram bot** -- standalone grammY bot in polling mode (`bot-dev.ts`)

### VPS Monitoring

The `scripts/vps-agent.sh` script runs as a systemd service on each monitored server, reporting metrics back to Sentinel via heartbeat endpoint with 30-second intervals.

### Database

```bash
npx prisma db push       # Sync schema to database
npx prisma generate      # Generate Prisma client
rm -rf .next             # Clear Turbopack cache after prisma generate
```

The schema contains 14 models and 16 enums. Seed data includes default users and 8 color-coded task tags.

---

## Project Structure

```
prisma/
  schema.prisma              # 14 models, 16 enums
  seed.ts                    # Users + 8 color-coded tags
scripts/
  vps-agent.sh               # VPS monitoring agent (bash, systemd)
src/
  app/
    (auth)/login/            # Bot-based Telegram login
    (dashboard)/
      admin/                 # 10 admin pages
      dev/                   # Board, tasks, gantt, VPS, credentials
      donor/                 # My donations with photo upload
      profile/               # Theme, DM preferences, saved colors
    api/
      auth/                  # TG auth, bot login, session, profile
      bmc/                   # BMC webhook + sync
      credentials/           # Vault CRUD + revision approval
      donors/                # Leaderboard
      exchange-rate/         # Live USD/INR rate
      notifications/         # In-app notifications
      projects/              # Project management
      services/              # Service registry
      subscriptions/         # Subscription tracking
      reminders/             # Scheduled reminders
      tags/                  # Tag CRUD
      tasks/                 # Task CRUD + my-tasks
      transactions/          # Treasury CRUD + stats + export + approve/reject
      upload/                # Photo upload endpoint
      users/                 # User management
      vps/                   # VPS CRUD + heartbeat
  components/
    Sidebar.tsx              # Nav with role switching, collapsible
    TopBar.tsx               # Notifications + profile
    Dropdown.tsx             # Custom dropdown component
  lib/
    appreciation.ts          # 10 donor appreciation messages
    auth.ts                  # JWT (jose), session, role helpers
    bot.ts                   # grammY bot instance
    db.ts                    # Prisma singleton with pg pool
    audit.ts                 # Audit logging
    github-log.ts            # GitHub immutable logs
    notifications.ts         # Unified notify (in-app + TG DM)
    telegram-log.ts          # Group topic logging
    role-colors.ts           # Role-based color system
  bot-dev.ts                 # Standalone bot server
```

---

<p align="center">
  <sub>Built for the PzP developer community</sub>
</p>
