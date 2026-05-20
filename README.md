# Sentinel — PzP Finance & Developers Hub

Community treasury management and developer collaboration platform for the PzP developer community. Built as a Telegram Mini App.

## Features

### Three-Role System
- **Admin** — Treasury overview, transaction management, subscription tracking, service registry, credential vault, user management, reminders, audit log
- **Dev** — Kanban project board with task creation, subtasks, colorful flair/tag system, credential access with approval flow
- **Donor** — Donation history, receipt tracking

### Credentials Vault
- Admin stores platform credentials (Hetzner, Cloudflare, etc.) with multi-field support
- Assigns access to specific developers
- Devs can propose updates or new credentials, requiring admin approval

### Task Management
- Kanban board with status columns (Backlog, To Do, In Progress, Review, Done)
- Subtask support with progress tracking
- Colorful tag/flair system (Backend, Frontend, Bug, Feature, DevOps, UI/UX, Security, Docs)
- Group by status or tag, filter by tag
- Task creation with assignee, priority, deadline, parent task, and tags

### Telegram Integration
- Mini App auth via initData HMAC-SHA256 validation
- OTP login fallback for web access
- Bot with group topic logging for critical events
- Profile photo sync from Telegram

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **Prisma 7** with PostgreSQL (driver adapters)
- **jose** for JWT (Edge-compatible)
- **Telegram Bot API** for notifications and auth
- **TypeScript** throughout

## Setup

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Fill in: DATABASE_URL, JWT_SECRET, BOT_TOKEN, GROUP_CHAT_ID

# Push schema to database
npx prisma db push

# Generate Prisma client
npx prisma generate

# Seed database (users + tags only)
npx tsx prisma/seed.ts

# Run dev server
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `BOT_TOKEN` | Telegram bot token |
| `GROUP_CHAT_ID` | Telegram group chat ID for topic logging |

## Project Structure

```
prisma/
  schema.prisma          # Database schema
  seed.ts                # Seed script (users + tags)
src/
  app/
    (auth)/login/        # Login page with OTP
    (dashboard)/
      admin/             # Admin dashboard pages
      dev/               # Dev board, tasks, credentials
      donor/             # Donor dashboard
      profile/           # User profile page
    api/
      auth/              # Auth endpoints (OTP, TG, logout, me)
      credentials/       # Credential vault CRUD
      projects/          # Projects and project tasks
      tags/              # Tag management
      tasks/             # Task CRUD and my-tasks
      transactions/      # Treasury transactions
      subscriptions/     # Subscription tracking
      services/          # Service registry
      reminders/         # Reminder management
  components/
    Sidebar.tsx          # Navigation sidebar with role switching
    TopBar.tsx           # Header with notifications and profile
  lib/
    auth.ts              # JWT, user session, role helpers
    db.ts                # Prisma client singleton
  bot-dev.ts             # Telegram bot (dev server)
```
