<p align="center">
  <img src="public/banner.png" alt="Sentinel" width="100%" />
</p>

<h1 align="center">Sentinel</h1>

<p align="center">
  Piratezparty's private treasury, donor, developer, and infrastructure workspace.
</p>

Sentinel combines a responsive Next.js dashboard, Telegram bot, PostgreSQL ledger, payment integrations, developer tooling, and VPS monitoring in one role-aware application.

## Features

### Admin

- Financial ledger with search, filters, pagination, CSV export, bulk review, reconciliation, and safe voiding.
- Guided income, purchase, subscription, renewal, reversal, and adjustment workflows.
- Pending approvals before service and VPS costs affect the treasury.
- Service catalogue with templates, billing history, receipts, reminders, credentials, and operational alerts.
- Razorpay and Buy Me a Coffee transaction verification and reconciliation.
- Donor management, payment access controls, broadcasts, reminders, and contribution leaderboard.
- Encrypted credential vault with audited reveal, grant, revoke, rotation, and recovery flows.
- VPS inventory, live telemetry, maintainer assignment, access requests, and granular alert preferences.
- GitHub repository activity, project/task administration, audit history, and workflow correlation.
- Role-specific onboarding, page tours, form-layout preferences, and notification centre.

### Donor

- One-time and monthly Razorpay or Buy Me a Coffee contributions when enabled.
- Manual contribution proof submission, later proof attachment, and pending-submission management.
- Contribution history, provider/currency-aware totals, leaderboard, receipts, and status updates.
- Appeals for rejected submissions plus notification and reminder preferences.

### Developer

- Project boards, assigned tasks/subtasks, tags, priorities, and GitHub activity.
- Required GitHub username during first-time onboarding.
- Project-scoped credential access and audited secret reveals.
- Assigned VPS visibility, live health data, SSH access requests, and granular alert subscriptions.

### Platform

- Telegram OTP authentication with role-based workspaces.
- Mobile-first layouts without horizontal scrolling for core dashboard flows.
- In-app and Telegram notifications, durable reminders, and delivery history.
- Soft deletion/archive for financial, service, and credential records where recovery matters.
- Durable Google Sheets synchronization jobs and Telegram-backed file archiving.
- Correlated audit records for multi-record workflows.

## Stack

- Next.js 16, React 19, TypeScript, and Tailwind CSS 4
- Prisma 7 with PostgreSQL/Supabase
- grammY and the Telegram Bot API
- Razorpay, Buy Me a Coffee, GitHub, Google Sheets, and Google Drive
- Vitest, ESLint, PM2, and a lightweight Linux VPS agent

## Quick start

Requirements: Node.js 22+, npm, and PostgreSQL.

```bash
git clone <repository-url> Sentinel
cd Sentinel
npm install
cp .env.example .env.local
npm run db:push
npm run db:seed
npm run dev:all
```

Open `http://localhost:3000`. Configure the values documented in [.env.example](.env.example) before testing Telegram, payments, GitHub, Sheets, or VPS features.

## Configuration

| Group | Variables |
| --- | --- |
| Core | `DATABASE_URL`, `JWT_SECRET`, `WEBAPP_URL` |
| Telegram | `BOT_TOKEN`, `BOT_USERNAME`, group and topic IDs |
| Encryption | `CREDENTIAL_ENC_KEY` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, optional webhook secret |
| Buy Me a Coffee | Page URL, account slug, webhook secret |
| GitHub | Organisation, activity token, audit-log token |
| Google | Sheets ID, service-account email, private key |

Never commit live credentials. Use test payment keys locally and rotate any secret exposed in logs, screenshots, or chat.

## Main workflows

### Transactions

`Transactions` contains the ledger, pending approvals, reconciliation, and the canonical record-transaction flow. Manual admin financial events use `/api/financial-events`; provider callbacks and donor proof submissions remain separate trust boundaries.

### Services

Services use templates for common infrastructure, subscriptions, domains, repositories, and other purchases. Each service presents one billing ledger; its initial payment is marked rather than stored as a separate payment system. Receipts and later renewals attach to the same history.

Recurring charges create pending transactions and notify admins. Service dates and treasury balances advance only after approval.

### VPS alerts

VPS alerts are disabled by default. When a developer is assigned to a server, Sentinel asks whether they want notifications and lets them select offline, CPU, memory, disk, and load alerts independently.

### Developer projects

Projects own their members, repositories, tasks, tags, and assignees. GitHub activity may remain visible to developers for community visibility, while mutation permissions are project-scoped. Task-to-GitHub-issue automation can build on this project/repository relationship.

## VPS agent

Create a server in Sentinel, copy its token, and run:

```bash
curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- --token YOUR_TOKEN
```

The systemd agent reports CPU, memory, disk, network, load, uptime, and process health. Useful commands:

```bash
systemctl status sentinel-agent
journalctl -u sentinel-agent -f
sudo systemctl restart sentinel-agent
```

## Production deployment

Sentinel runs as `sentinel-web` and `sentinel-bot` under PM2. Deploy from the VPS repository:

```bash
cd ~/Sentinel
bash upgrade.sh
```

The script fast-forwards `main`, installs locked dependencies, normalizes legacy duplicate project tags, applies the Prisma schema, regenerates the client, builds the app, restarts PM2, and verifies the agent installer endpoint. No separate migration SQL is required for the current schema update.

For a small VPS, ensure enough RAM or swap for the production build. Override the default build heap when needed:

```bash
SENTINEL_BUILD_HEAP_MB=4096 bash upgrade.sh
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the web app |
| `npm run bot:dev` | Start the Telegram bot |
| `npm run dev:all` | Start web and bot together |
| `npm test` | Run unit tests |
| `npm run lint` | Run ESLint |
| `npm run build` | Create the production build |
| `npm run db:push` | Apply the Prisma schema |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:seed` | Seed required initial data |
| `npm run sheets:sync` | Refresh the finance workbook |

Before deployment:

```bash
npm run lint
npm test
npm run build
```

## Security model

- Protected pages are gated by `src/proxy.ts`; protected APIs repeat authentication and role checks.
- Credentials and VPS secrets are encrypted at rest and excluded from bulk list responses.
- Sensitive reveal, access, mutation, review, and deletion actions are audited.
- Financial proofs are private owner/admin documents; avatars use a separate cacheable path.
- Provider-created payments are accepted only after server-side verification.
- Voided transactions and archived services remain available for audit and recovery.
- The VPS agent authenticates with a server-specific token rather than a user session.

## Repository map

```text
prisma/                 Database schema and seeds
public/                 Product and provider assets
scripts/                VPS agent, finance sync, and recovery utilities
src/app/                Pages and API route handlers
src/components/         Shared responsive UI
src/lib/                Domain, security, and integration modules
src/bot-dev.ts          Telegram bot process
src/proxy.ts            Authentication and role routing
upgrade.sh              Production upgrade script
```

The former developer Gantt page is intentionally absent from `main`; its archived implementation belongs only in the archive branch.

---

<p align="center"><strong>I stand watch.</strong></p>
