# PzP Sentinel — Master Plan

**Repo:** github.com/zxcvresque/Pzp-Sentinel
**Stack:** Next.js 16, Prisma 7, PostgreSQL 16, Telegram Bot API (grammY), TypeScript 5
**Bot:** @TheSentinelRobot
**Auth:** Telegram Mini App (initData HMAC-SHA256) + OTP fallback for web
**Deploy target:** Ubuntu (Hetzner VPS)

---

## What's already built

### Auth & Core
- [x] Telegram Mini App auth via initData validation
- [x] OTP login (request via bot DM, verify on web)
- [x] "Don't know your ID?" deep link to bot (`/start myid`)
- [x] JWT sessions (jose, Edge-compatible)
- [x] Role-based middleware (ADMIN/DONOR/DEV route guards)
- [x] Profile page (avatar from TG, name, username, roles)
- [x] Profile icon + logout dropdown in top bar
- [x] Landing page + login page (glassmorphism, background image)

### Admin Portal
- [x] Treasury dashboard (balance, donation/expense stats)
- [x] Transaction CRUD with approve/reject workflow
- [x] Subscription tracking (platform, price, frequency, specs, expiry)
- [x] Services registry (category, custom columns, entries)
- [x] User management (create, assign roles)
- [x] Credential vault (multi-field, revision chain, assignees)
- [x] Reminders (frequency, role targeting, channel selection)
- [x] Audit log viewer

### Donor Portal
- [x] Donation history with status
- [x] Receipts page

### Dev Portal
- [x] Kanban board (5 columns: Backlog/Todo/In Progress/Review/Done)
- [x] Task creation (title, description, priority, assignee, deadline, parent task)
- [x] Subtask support with progress indicators
- [x] Tag/flair system (8 color-coded tags: Backend, Frontend, Bug, Feature, DevOps, UI/UX, Security, Docs)
- [x] Group by status or tag, filter by tag
- [x] My Tasks view
- [x] Dev credentials (propose/approve workflow)

### Telegram Bot
- [x] /start with welcome message + webapp button
- [x] /start myid deep link (returns user's TG ID)
- [x] OTP delivery via DM
- [x] Group topic logging for audit events

### Data Model (12 models, 16 enums)
- [x] User, Transaction, Subscription, Service, Project, Tag, Task, Reminder, Credential, AuditLog

---

## Full feature set

### Admin Portal

| #  | Feature                  | Details                                                                                                                                                          | Status  |
|----|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| 1  | Finance logging          | Manual entry: amount, from, method (UPI/BMC/other), screenshot proof (uploaded to TG group), date/time, notes. Edit/delete with audit trail                      | Partial |
| 2  | Balance dashboard        | Total in minus total out = current balance. Burn rate, runway months, donation trends chart, cost breakdown by category (pie)                                     | Partial |
| 3  | Subscription manager     | Track ongoing costs: platform, plan link, price, frequency, payment proof, specs. Presets for VPS (members, expiry, credits, storage, bandwidth) + custom fields. Expiry alerts at 7/3/1 days (color-coded red/yellow/green) | Partial |
| 4  | Services registry        | Categories: VPN, Server, AI, Custom. Each has columns/entries admins define. Custom column support for anything                                                   | Done    |
| 5  | User & role management   | Create accounts (link TG ID), assign multi-role (admin/donor/dev), deactivate. No self-signup                                                                     | Done    |
| 6  | Donor approval workflow  | Pending/approved/rejected with reason. Notification to donor on status change                                                                                     | Done    |
| 7  | Reminders                | Set frequency + message for any recurring task. Delivered via bot notification + in-app                                                                           | Partial |
| 8  | Top donors leaderboard   | Admin-only view. Ranked by total contribution. Period filters (all-time, year, month)                                                                             | Todo    |
| 9  | Audit log                | Immutable record of every write action: who, what, when, before/after values                                                                                      | Done    |
| 10 | Multi-currency           | BMC comes in USD, local in INR. Auto-fetch exchange rate at transaction time. Toggle view INR/USD                                                                 | Todo    |
| 11 | Export                   | CSV/Excel export of transactions, monthly auto-generated financial summary PDF                                                                                    | Todo    |
| 12 | Public transparency page | Read-only, no names. Total donated, total spent, current balance, active services. Builds trust                                                                   | Todo    |

### Donor Portal

| #  | Feature            | Details                                                                                    | Status  |
|----|--------------------|--------------------------------------------------------------------------------------------|---------|
| 1  | Donation history   | Full log of their contributions with status (pending/approved/rejected)                     | Done    |
| 2  | Submit payment     | Upload proof, enter amount/method, goes to admin approval queue                             | Todo    |
| 3  | BMC integration    | One-time + recurring. Webhook auto-logs donations. Monthly auto-pay history tracked         | Todo    |
| 4  | Receipt download   | Per-donation or monthly summary PDF                                                        | Todo    |
| 5  | Profile            | Basic info, notification preferences                                                       | Partial |

### Dev Portal

| #  | Feature              | Details                                                                                                                      | Status  |
|----|----------------------|------------------------------------------------------------------------------------------------------------------------------|---------|
| 1  | Project board (Kanban) | 5 status columns, drag-and-drop cards, assignee, priority, deadline, notes                                                  | Done    |
| 2  | Gantt chart          | Visual timeline of projects/tasks. Auto-derived from kanban card dates. Dependency arrows between tasks. Simple, not complex  | Todo    |
| 3  | Git integration      | Link GitHub/GitLab repos per project. Show recent commits, open PRs, branch status on project cards. Webhook-driven updates  | Todo    |
| 4  | Admin-assigned todos | Admins create tasks, assign to devs, set deadlines. Devs see their task list filtered                                        | Done    |
| 5  | VPS stats (Phase 4)  | Specs, bandwidth, storage usage. Daily/weekly/monthly/6mo views. Agent on VPS reports to API                                 | Todo    |

### Telegram Bot (@TheSentinelRobot)

| #  | Feature        | Details                                                                          | Status  |
|----|----------------|----------------------------------------------------------------------------------|---------|
| 1  | /start         | Welcome message + "Open PzP Finance" webapp button                               | Done    |
| 2  | /start myid    | Deep link returns user's Telegram ID in copyable format                          | Done    |
| 3  | OTP delivery   | Sends login code when user authenticates on webapp                               | Done    |
| 4  | Notifications  | Reminders, approval status changes, expiry alerts, new task assignments           | Partial |
| 5  | File relay     | Receives screenshots uploaded via webapp, stores to designated TG group, returns file reference | Todo |

---

## Data model (current schema)

```
User          id, telegram_id, telegram_user, name, photo_url, chat_id, roles[], status, otp_code, otp_expires_at, created_by
Transaction   id, amount, currency, method, direction, type, from_user, description, proof_file_id, date, status, reviewed_by, review_note, bmc_event_id, created_by
Subscription  id, platform, plan_url, price, currency, frequency, proof_file_id, specs{}, expiry_date, last_renewal_date, paid_tx_id, status
Service       id, category, name, columns[], entries[]
Project       id, name, repo_url, description, status, members[]
Tag           id, name, color
Task          id, project_id, title, description, assignee, status, priority, start_date, deadline, parent_id, tags[], created_by
Reminder      id, created_by, message, frequency, next_fire, channel, recipient_roles[]
Credential    id, platform, label, value, assignees[], status, created_by, reviewed_by, parent_id (revision chain)
AuditLog      id, user_id, action, entity_type, entity_id, transaction_id, before{}, after{}, timestamp
```

Schema additions needed for full plan:
- `Donation` model (or extend Transaction with donor-specific fields)
- `bmcSubscriptionId` on Transaction for BMC recurring tracking
- `Notification` model for in-app notification queue
- `VpsStats` model for Phase 4 monitoring data

---

## Logging strategy — GitHub logs repo

Instead of relying on Telegram for all logging, we use a **separate private GitHub repo** as the primary audit/log store.

**How it works:**
- Dedicated private repo (e.g. `zxcvresque/pzp-sentinel-logs`)
- Different log files for different concerns: `audit.jsonl`, `transactions.jsonl`, `approvals.jsonl`, `bot-events.jsonl`, etc.
- Each log entry is a **commit to the relevant file** — git handles timestamps, immutability, and version history for free
- Logs can never be silently deleted — git history preserves everything
- Easy to diff, roll back, or trace any action to a specific point in time
- The app commits via GitHub API (or a local clone on the VPS that pushes periodically)

**Telegram is only for:**
- Proof photos (payment screenshots, receipts) — TG group is the file store since we need the `file_id`
- Critical alerts that need immediate human attention (large expenses, failed payments, security events)

**Why this is better:**
- No dependency on Telegram for log durability — if bot gets removed from group, logs are safe
- Full version history on every log file — can see exactly what changed and when
- Structured JSONL files are easy to query, export, or pipe into dashboards
- GitHub gives free private repos with unlimited history
- Separates concerns: TG for photos + alerts, GitHub for structured audit trail

---

## Open TODOs (from eng review)

1. **Handle Telegram group upload failures gracefully** (P1, Phase 1)
   Wrap TG sendPhoto in try/catch. Don't save transaction without valid proof. Check bot group membership.

2. **Add notification delivery fallback** (P1, Phase 1)
   If bot DM fails (user blocked bot), fall back to in-app notification. Log delivery failure.

3. **BMC webhook deduplication** (P2, Phase 2)
   Store BMC event ID, check before insert. Standard idempotency pattern.

---

## Phases

### Phase 1 — Foundation + Finance (current)
- Auth (TG OTP) .......................... Done
- Roles + middleware ...................... Done
- Admin finance logging ................... Partial (needs: proof upload, edit/delete, audit trail on edits)
- Balance dashboard ....................... Partial (needs: burn rate, runway, charts)
- Donor submit + approval flow ........... Done (approval), Todo (donor submission form)
- Bot (start + OTP + notifications) ...... Done (start/OTP), Partial (notifications)
- File storage via TG group .............. Todo
- Notification delivery fallback ......... Todo (P1 from eng review)
- TG upload failure handling ............. Todo (P1 from eng review)

### Phase 2 — Subscriptions + Services
- Subscription manager with presets + alerts (expiry countdown colors)
- Services registry with custom columns (done, needs polish)
- Reminders with bot delivery (partial, needs bot push)
- Export CSV/Excel
- Multi-currency (INR/USD toggle, auto exchange rate)
- BMC webhook integration + deduplication

### Phase 3 — Dev Portal + Integrations
- Kanban board (done)
- Gantt chart (timeline view derived from task dates)
- Git webhooks (GitHub/GitLab, show commits/PRs on project cards)
- Task assignment from admin (done)
- BMC webhook for auto-logging donations
- Top donors leaderboard (admin-only, period filters)

### Phase 4 — Analytics + Monitoring
- VPS stats agent (runs on server, reports to API)
- Burn rate / runway charts
- Donation trend analytics
- Public transparency page (read-only, anonymous)
- Receipt PDFs (per-donation + monthly summary)
- Audit log viewer with filters (done, needs before/after diff view)

---

## Existing artifacts

- **Design doc** — Approved, updated with all review decisions
- **TODOS.md** — 3 items from eng review (TG upload failures, notification fallback, BMC dedup)
- **Nav comparison wireframe** — Role-based sidebar navigation
- **Test plan** — QA coverage for auth, transactions, subscriptions, bot flows

---

## Tech notes

- Next.js 16 App Router with Turbopack
- Prisma 7 with driver adapters (@prisma/adapter-pg + pg Pool)
- JWT via jose (Edge-compatible), NOT jsonwebtoken
- Params pattern: `{ params }: { params: Promise<{ id: string }> }`
- Cookie set on response object, NOT via cookies() from next/headers
- `prisma db push` instead of `prisma migrate dev`
- Bot: grammY framework, polling mode, separate process (bot-dev.ts)
- Design system: dark editorial theme with lime (#C8FF00) accent, glassmorphism on public pages
- Brand mark: `Ｓ ☰ ＮＴＩＮ ☰ Ｌ` (fullwidth unicode, Inter extrabold, letterSpacing 0.05em, whitespace-nowrap)
