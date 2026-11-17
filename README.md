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
- Captured Razorpay payments are reconciled every 15 minutes, including one-time
  orders missed by webhooks or checkout callbacks. Recovery updates the donor's
  history and sends a funds-group thank-you through the same delivery claim.
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
- Monthly giving reminders wait 12 hours after the expected payment time, anchored
  to the first approved monthly contribution, and skip paid billing months.
- Donation reminders have 15 DM variants and 15 monthly group variants. Each
  channel rotates independently, skipping a donor's previous wording. Rotation
  is stored in PostgreSQL and survives bot restarts. Apply the Prisma schema
  before restarting the updated bot (`npm run db:push`, included in `upgrade.sh`).

### Developer

- Project boards, assigned tasks/subtasks, tags, priorities, and GitHub activity.
- Required GitHub username during first-time onboarding.
- Project-scoped credential access and audited secret reveals.
- Assigned VPS visibility, live health data, SSH access requests, and granular alert subscriptions.

### Platform

- Telegram OTP authentication with role-based workspaces.
- Eligible PzP members receive donor access when they sign in from the Telegram
  WebApp, even before starting the Sentinel bot. First-time donors see the donor
  welcome slides and tours.
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

### PzP member access and unused accounts

For Telegram WebApp sign-in, set `PZP_MEMBERSHIP_API_KEY` in Sentinel's server
environment. Sentinel verifies Telegram's signed launch data before looking up
the Telegram ID in the PzP partner API. New and pending accounts can receive
donor access when the API returns `exists: true` and `banned: false`. The same
check can reactivate disabled accounts and starts a fresh 15-day window. The API
check grants the Sentinel donor role regardless of the upstream role. An
unavailable lookup returns a retryable sign-in error.
Admins can see automatic grants and reactivations in Audit Logs.

The bot and browser sign-in flows use the deployed allowlist in
`src/lib/pzp-member-ids.json`, generated from the
Telegram IDs in `scripts/members.txt`; IDs in `scripts/members_bots.txt` are
excluded. Run `npm run members:sync` after refreshing those exports. The deployed
list contains IDs only, so the raw exports and Telegram export session are not
needed on the server. Existing admin/developer members also receive donor access
alongside their other roles. Membership alone never grants admin or developer access.

Before deploying this change, apply `scripts/member-access-schema.sql` to the
existing database (or use the repository's `npm run db:push` workflow), then
regenerate Prisma and build. Both new columns are nullable and additive.

After more than 15 days without a contribution, donor/pending accounts are
disabled and hidden from Sentinel's normal user lists. The window starts when
donor access is granted, with registration time as a fallback for existing users.
The window starts again when an account is reactivated. Real donations,
including refunded donations, keep the account exempt. Pending contributions
are retained until admin review.
Test payments and rejected submissions do not establish donor history. Admins
and developers are exempt from this donor cleanup.

Cleanup runs hourly in the polling bot, when admins load user/donor lists, and
is enforced during authenticated access. Removal retains the database row and
all provider references so delayed payments can still be credited. A real
contribution received later restores accounts removed by cleanup. Admins can
select **Include automatically removed accounts** under Users to restore or
delete an account. Restoring one starts a fresh 15-day window. The source PzP
member list is never changed by cleanup.

### Razorpay recovery

Razorpay recovery uses the configured API key and secret; incoming Razorpay
webhooks are optional. Keep the `sentinel-bot` PM2 process running for scheduled
API polling and enable automatic payment capture in the Razorpay dashboard.
Sentinel records money only after Razorpay's API confirms capture and matches
the stored order/subscription amount, currency and ownership.

The polling bot reconciles every 15 minutes, scanning every page of captured
payments over the past 35 days with a fixed time boundary. It also retries
incomplete webhook payment/order receipts, including receipts older than that
window, and known subscription authorization payments. A failed collection scan
does not prevent these reference-based retries, and one bad payment does not
block the rest. Admins can also use **Sync Razorpay now** in Reconciliation.
Checkout verification runs independently of polling. If signed Razorpay
webhooks are configured, they provide an additional recovery path.

Recovery applies to all gateway payment methods, including netbanking. An
expired/revoked guest invitation prevents new checkout creation but does not
prevent recording a captured payment on an existing server-owned order.
Incomplete or unmatched receipts remain visible in Reconciliation instead of
being marked processed. Provider payment IDs and order claims prevent duplicate
ledger entries. An authorized but uncaptured bank payment is not counted as a
donation; donors are advised to wait before paying again if money was debited.

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

The script fast-forwards `main`, installs locked dependencies, normalizes legacy uniqueness conflicts, applies the Prisma schema, regenerates the client, builds the app, restarts PM2, and verifies the agent installer endpoint. No separate migration SQL is required for the current schema update.

Prisma, bot jobs, and raw donor-bridge/webhook queries share one PostgreSQL pool
per process, capped at four connections. With one web process and one bot
process, Sentinel can use up to eight sessions, leaving headroom under the
current 15-session database pooler limit. Additional app instances, scripts, and
other services using the same database each consume their own connection budget.
Idle runtime connections are released after 10 seconds.

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
