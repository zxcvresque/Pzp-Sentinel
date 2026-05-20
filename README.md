<p align="center">
  <img src="public/banner.png" alt="Sentinel Banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?style=flat-square&logo=telegram&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/License-Private-gray?style=flat-square" />
</p>

<p align="center">
  Community treasury management and developer collaboration platform for the PzP developer community.<br/>
  Built as a Telegram Mini App.
</p>

---

## Features

### `ADMIN` Treasury & Operations
> Full financial oversight, platform management, and team coordination.

- Treasury dashboard with balance, donations, and expense tracking
- Transaction management with approval workflow
- Subscription tracking (Hetzner, Cloudflare, OpenAI, etc.)
- Service registry with dynamic columns and entries
- Credential vault with multi-field storage and developer assignment
- User management with role assignment
- Reminders with role-based targeting and scheduling
- Audit log for all administrative actions

### `DEV` Project Board & Credentials
> Kanban workflow with tags, subtasks, and secure credential access.

- Kanban board with 5 status columns (Backlog, To Do, In Progress, Review, Done)
- Task creation with priority, assignee, deadline, and parent task
- Subtask support with progress indicators
- Colorful tag/flair system: `Backend` `Frontend` `Bug` `Feature` `DevOps` `UI/UX` `Security` `Docs`
- Group by status or tag, filter by tag
- Credential access with propose/approve workflow

### `DONOR` Contributions
> Track donations and download receipts.

- Donation history and status tracking
- Receipt management

### Telegram Integration
- Mini App auth via `initData` HMAC-SHA256 validation
- OTP login fallback for web access
- Bot with group topic logging for critical events
- Profile photo sync on login

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
DATABASE_URL=postgresql://user:pass@localhost:5432/sentinel
JWT_SECRET=your-secret-key
BOT_TOKEN=your-telegram-bot-token
GROUP_CHAT_ID=your-telegram-group-id
```

```bash
# Database setup
npx prisma db push
npx prisma generate
npx tsx prisma/seed.ts

# Run
npm run dev
```

---

## Project Structure

```
prisma/
  schema.prisma              # 12 models, 16 enums
  seed.ts                    # Users + 8 color-coded tags
src/
  app/
    (auth)/login/            # OTP login with background art
    (dashboard)/
      admin/                 # 8 admin pages (treasury, users, credentials, etc.)
      dev/                   # Kanban board, my tasks, dev credentials
      donor/                 # Donation dashboard, receipts
      profile/               # User profile with TG info
    api/
      auth/                  # OTP, Telegram Mini App, logout, session
      credentials/           # Vault CRUD + revision approval
      projects/              # Projects + task management
      tags/                  # Tag upsert
      tasks/                 # Task CRUD, my-tasks
      transactions/          # Treasury transactions
      subscriptions/         # Subscription tracking
      services/              # Service registry
      reminders/             # Scheduled reminders
  components/
    Sidebar.tsx              # Nav with role switching
    TopBar.tsx               # Notifications + profile dropdown
  lib/
    auth.ts                  # JWT (jose), session, role helpers
    db.ts                    # Prisma singleton
  bot-dev.ts                 # Telegram bot server
```

---

<p align="center">
  <sub>Built for the PzP developer community</sub>
</p>
