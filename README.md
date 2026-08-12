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
  Private financial ops, team management, and infrastructure monitoring platform for the PzP developer community.<br/>
  Telegram-native auth, role-based access, real-time VPS monitoring, and immutable audit logging.
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
| Theme | Glassmorphism dark UI (`#111116` base, `#6FD1D7` default accent) |

---

## 🚀 Quick Start

```bash
git clone https://github.com/zxcvresque/Pzp-Sentinel.git
cd Pzp-Sentinel
npm install
cp .env.example .env
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/sentinel

# Telegram Bot
BOT_TOKEN=your-telegram-bot-token
BOT_USERNAME=TheSentinelRobot
BOT_WEBHOOK_SECRET=your-webhook-secret

# Auth
JWT_SECRET=your-jwt-secret

# Secrets-at-rest encryption (32-byte key, base64). REQUIRED in production.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# IMPORTANT: use the SAME value across environments that share a database —
# changing it makes already-encrypted credential/VPS secrets unreadable.
CREDENTIAL_ENC_KEY=your-32-byte-base64-key

# App
WEBAPP_URL=https://sentinel.piratezparty.com

# Telegram Group Topics
TG_GROUP_ID=your-group-id
TG_TOPIC_AUDIT=topic-id
TG_TOPIC_TRANSACTIONS=topic-id
TG_TOPIC_SCREENSHOTS=topic-id

# Donations group for public donation thank-yous (optional). If unset, thank-yous
# fall back to TG_GROUP_ID's General topic (testing). Omit the topic id for General.
TG_DONATION_GROUP_ID=your-donation-group-id
TG_DONATION_TOPIC_ID=

# Google Sheets finance mirror + Telegram workbook backups
GOOGLE_SHEETS_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=sentinel-sheets@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
TG_TOPIC_BACKUPS=topic-id

# GitHub Audit Logs
GITHUB_LOGS_TOKEN=your-github-pat

# Buy Me a Coffee
BMC_PAGE_URL=https://buymeacoffee.com/your-creator-slug
BMC_ACCOUNT_SLUG=your-creator-slug
BMC_WEBHOOK_SECRET=your-webhook-signing-secret
# Optional legacy API token; new accounts may not offer one.
BMC_TOKEN=
```

### Database Setup

```bash
npx prisma db push
npx prisma generate
npx tsx prisma/seed.ts
```

### Buy Me a Coffee Setup / Account Replacement

Sentinel uses Buy Me a Coffee in two ways:

- Embedded checkout: the donor opens BMC's official checkout widget over the Sentinel dashboard, so payment stays in the Sentinel experience while BMC owns checkout and capture. If the widget cannot load, Sentinel safely falls back to the configured creator page.
- Live updates: `POST /api/bmc/webhook` verifies `x-signature-sha256`, stores the delivery, creates or updates the matching Sentinel transaction, logs the event to Telegram/audit history, and refreshes the Sheets mirror.
- Optional legacy sync: `POST /api/bmc/sync` remains available only when an older account still has a working `BMC_TOKEN`.

From the active Buy Me a Coffee account, collect:

```env
BMC_PAGE_URL=https://buymeacoffee.com/your-creator-slug
BMC_ACCOUNT_SLUG=your-creator-slug
BMC_WEBHOOK_SECRET=your-bmc-webhook-secret
BMC_TOKEN=
```

In the BMC developer/webhook settings, set the webhook URL to:

```text
https://sentinel.piratezparty.com/api/bmc/webhook
```

Enable all available events, or at minimum the events Sentinel handles:

```text
donation.created
donation.refunded
extra_purchase.created
extra_purchase.refunded
extra_purchase.updated
recurring_donation.started
recurring_donation.cancelled
recurring_donation.updated
membership.started
membership.cancelled
membership.paused
membership.updated
commission_order.created
commission_order.refunded
wishlist_payment.created
wishlist_payment.refunded
```

To replace an existing BMC account on the VPS:

```bash
cd ~/Sentinel
nano .env
# replace BMC_PAGE_URL, BMC_ACCOUNT_SLUG, and BMC_WEBHOOK_SECRET
npm run db:push
pm2 restart sentinel-web
pm2 save
```

Then verify from the admin dashboard:

1. Open `Admin -> Dashboard`.
2. Open the webhook in BMC and use **Send test event** for `donation.created`.
3. Confirm BMC shows a `2xx` delivery and Sentinel shows the test receipt without adding it to live treasury totals.
4. Complete one small real BMC payment and confirm it appears automatically in `Admin -> Transactions`, Telegram audit logs, and the Sheets mirror.

Previously imported BMC transactions remain in the database. `BMC_ACCOUNT_SLUG` namespaces new provider IDs so replacing an account cannot collide with the previous account's records. The webhook signing secret must never be exposed to client code.

One-time guest links use a Telegram bot deep link. The admin enters a payer label, optional note, expiry, and whether Razorpay should be available alongside the default BMC option, then sends the generated `https://t.me/<BOT_USERNAME>?start=donate_<token>` link privately. When the recipient taps **Start**, Telegram supplies the sender's immutable numeric ID and optional username. The bot atomically binds that identity to the invitation and only then returns the Sentinel payment options.

### Run

Two separate processes:

```bash
npm run dev        # Next.js dev server
npm run bot:dev    # Telegram bot (separate terminal)
```

### Google Sheets finance mirror

Sentinel can maintain a read-only finance workbook with pastel dashboard cards, native charts, transaction data, monthly and expense summaries, donor totals, service costs, change history, and reconciliation checks. Sentinel remains the only data-entry surface; the service account needs Editor access while human viewers can remain Viewer-only.

Enable the Google Sheets and Drive APIs, share the target spreadsheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`, configure the variables above, then initialize or manually refresh it with:

```bash
npm run sheets:sync
```

Transaction creation refreshes the workbook and sends a timestamped XLSX snapshot to `TG_TOPIC_BACKUPS`. Updates, approvals, rejections, and deletions refresh the workbook and are recorded in Telegram transaction/audit logs. Admins can also use **Sync Sheets** and **Backup Now** from the Transactions page.

### Razorpay donations

Sentinel uses Razorpay Standard Checkout for dashboard donations. Orders are created on the server, the checkout HMAC is verified against the server-stored order ID, and the payment is fetched from Razorpay before Sentinel records an automatically approved transaction. Only a matching `captured` payment is accepted. A signed webhook provides a recovery path when the browser closes before verification finishes.

Configure:

```env
RAZORPAY_KEY_ID="rzp_test_..."
RAZORPAY_KEY_SECRET="..."
RAZORPAY_WEBHOOK_SECRET="a-separate-random-webhook-secret"
```

In Razorpay Dashboard, create a webhook pointing to:

```text
https://your-domain.com/api/webhooks/razorpay
```

Subscribe it to `payment.captured`, `order.paid`, and `payment.failed`, and use exactly the same dedicated webhook secret in both places. Test-mode payments are visibly recorded for QA but excluded from real treasury totals, burn-rate calculations, donor rankings, and Google Sheets dashboard calculations.

Admins can also create expiring, revocable **one-time guest payment links** from **Admin > Donors**. The generated link opens the configured Telegram bot, which captures the payer's numeric Telegram ID directly from the `/start` sender and returns payment options only after a successful one-account claim. BMC is included by default; optional Razorpay access is enforced by the invitation and that invitation is consumed after a server-verified Razorpay capture. Sentinel stores only a SHA-256 hash of the secret token.

### Donor payment access

Payment controls live under **Admin → Donors**:

- Buy Me a Coffee is enabled for every donor by default and can be hidden per donor inside Sentinel.
- Razorpay is disabled by default. An admin can enable or disable it persistently for selected donors with **Allow Razorpay**.
- One-time guest invitations include BMC by default. Admins can select **Also allow Razorpay** while creating an invitation when that guest should see both methods.
- Donor Razorpay permission is checked server-side whenever an order is created. Guest Razorpay permission is checked independently against the claimed invitation. Test or live behavior is selected exclusively by `RAZORPAY_KEY_ID`; production UI does not use demo orders.
- Payment method logos are display guidance only. Razorpay Checkout remains authoritative and shows the methods enabled on the Razorpay account and supported by the payer's device.

Before production deployment, apply the new Prisma models and enum:

```bash
npm run db:generate
npm run db:push
```

Replace test keys with live keys only after an end-to-end test. Payment methods (UPI Intent/QR, cards, netbanking, and wallets) are controlled by the Razorpay account's enabled methods. Never expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` to client code.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run bot:dev` | Telegram bot in polling mode |
| `npm run db:seed` | Seed database with default users + tags |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:generate` | Regenerate Prisma client |
| `npm test` | Run unit tests (Vitest) |

---

## 🖥 VPS Agent Setup

Lightweight bash agent that collects system metrics (CPU, RAM, disk, network, uptime, load average) and POSTs them to Sentinel every 30 seconds via systemd.

### 1. Register the server

In the Sentinel admin panel, go to **VPS Stats** and add a server. Copy the token — it's shown once.

### 2. Install on the target VPS

```bash
curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- --token YOUR_TOKEN
```

This will:
- Install the agent to `/usr/local/bin/sentinel-agent`
- Create a hardened systemd service (`sentinel-agent.service`)
- Enable and start the service
- Verify the first heartbeat

### Self-registration mode

Skip the dashboard step — register the server directly from the VPS using your admin JWT:

```bash
curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- \
  --register --api-key YOUR_JWT \
  --name "web-01" --platform ubuntu --provider hetzner
```

Auto-detects public IP and gets a token back from the API.

### Agent management

```bash
journalctl -u sentinel-agent -f        # Live logs
systemctl status sentinel-agent         # Service status
systemctl restart sentinel-agent        # Restart
```

### Uninstall

```bash
sudo systemctl disable --now sentinel-agent
sudo rm /usr/local/bin/sentinel-agent /etc/systemd/system/sentinel-agent.service
sudo systemctl daemon-reload
```

---

## 🛰 Deployment

Sentinel runs as two processes in production:

```mermaid
graph LR
  subgraph VPS[" Ubuntu VPS "]
    PM2[PM2 / systemd]
    PM2 --> NextProc[Next.js<br/>port 3000]
    PM2 --> BotProc[grammY Bot<br/>polling]
  end

  Nginx[Nginx Reverse Proxy<br/>sentinel.piratezparty.com] --> NextProc
  BotProc <--> TG[Telegram API]

  classDef core fill:#0d3b45,stroke:#6FD1D7,color:#e0f7fa,stroke-width:2px
  classDef proxy fill:#1a1a40,stroke:#818cf8,color:#c7d2fe,stroke-width:1.5px
  classDef process fill:#14332a,stroke:#4ade80,color:#d1fae5,stroke-width:1.5px
  classDef telegram fill:#1c1636,stroke:#a78bfa,color:#ddd6fe,stroke-width:1.5px

  class PM2 core
  class NextProc,BotProc process
  class Nginx proxy
  class TG telegram

  style VPS fill:#0a2a30,stroke:#6FD1D7,stroke-width:2px,color:#6FD1D7
```

1. **Next.js application** — web frontend and all API routes
2. **Telegram bot** — standalone grammY bot in polling mode (`bot-dev.ts`)

### Database

```bash
npx prisma db push       # Sync schema
npx prisma generate      # Regenerate client
rm -rf .next             # Clear build cache after prisma generate
```

Schema: 13 models, 19 enums. Seed data includes default users and 8 color-coded task tags.

### Deploying updates

Production serves the **compiled `.next` build**, so a bare `git pull` keeps serving the old bundle. You must rebuild **and** restart both PM2 processes:

```bash
cd ~/Sentinel
git pull
npm ci
npx prisma db push
npx prisma generate
rm -rf .next
npm run build
pm2 restart sentinel-web sentinel-bot
pm2 save
```

- `sentinel-web` — the Next.js app (web + API routes)
- `sentinel-bot` — the grammY bot (donation thank-yous, donor reminders, service-expiry alerts)

> If a change still isn't visible, confirm Cloudflare isn't caching HTML: `curl -sI https://sentinel.piratezparty.com/ | grep -i cf-cache-status` should be `DYNAMIC` (not `HIT`). Only `/_next/static/*` should be edge-cached.

---

## 🔐 Roles

Three roles with distinct navigation, theming, and permissions.

| Role | Theme | Access |
|------|-------|--------|
| **ADMIN** | Violet | Dashboard, Transactions, Services (catalogue, credentials, VPS), Donors, Users, Reminders, Audit Log |
| **DEV** | Cyan | Board, My Tasks, Services (VPS and credentials) |
| **DONOR** | Amber | My Donations, Receipts |

Users can hold multiple roles. The sidebar switches context per role, with settings pages (General + Audit Log) accessible from any role.

---

## ⚙ Features

### Admin — Treasury and Operations

- Treasury dashboard with real-time balance, multi-currency support (INR/USD with live exchange rate)
- Transaction approval/rejection workflow with receipt photo viewing
- CSV export for all transactions
- Service registry with dynamic columns
- Credential vault — AES-256-GCM encrypted at rest, per-dev access levels (public-key vs full), audited reveals, and VPS secrets auto-linked from the server
- User management with role assignment and status control
- Reminders with role-based targeting
- VPS server monitoring — live CPU, RAM, disk, network metrics from bash agents with 30s refresh
- Server approval flow for dev-requested VPS nodes
- Donor leaderboard
- Automatic donation thank-yous — public post in the donations group (@mention, tiered by amount) + personal DM; admin-recorded donations are flagged as on-behalf
- Full audit log with GitHub-backed immutable history
- Buy Me a Coffee integration — webhook receiver + manual sync for all BMC event types

### Dev — Project Board and Credentials

- Kanban board with 5 status columns (Backlog, To Do, In Progress, Review, Done)
- Task management with priority levels, subtasks, deadlines, and color-coded tags
- 8 tags: `Backend` `Frontend` `Bug` `Feature` `DevOps` `UI/UX` `Security` `Docs`
- VPS stats (read-only monitoring + request new servers pending admin approval); request SSH access by submitting your own public key — an admin installs it and the server password/private key is never shared
- Credential access — public-key (your installed key shown for reference) or full (reveal the secret); propose/approve workflow for credentials you own

### Donor — Contributions

- Donation submission with amount, currency (INR/USD), method (UPI / BMC / Bank / Other), and reference
- Photo receipt upload (max 20 MB)
- Status tracking across pending, approved, and rejected states
- 3 stat cards: total contributed, pending count, approved count
- Appreciation messages on approval (5 normal + 5 generous thresholds based on average donation)
- Tiered public thank-you in the donations group + a personal DM when a donation is approved
- Donate reminders via DM — default monthly (around the 5th), adjustable to weekly / every 2 weeks / off from Profile (donor-only)

### Telegram Integration

- Mini App auth via `initData` HMAC-SHA256 validation
- Bot-based login flow (@TheSentinelRobot) with OTP
- Group topic logging (audit, transactions, screenshots)
- DM notifications with inline keyboard buttons linking to relevant pages
- 9 configurable notification categories (all ON by default for new users)
- HIGH priority notifications (approvals, rejections) bypass user preferences
- Profile photo sync from Telegram

### Platform-Wide

- Immutable audit log backed by GitHub commits (Sentinel-Logs repo) + a Telegram audit-topic mirror for credential events
- Secrets encrypted at rest (AES-256-GCM): credential values and VPS passwords/keys
- Buy Me a Coffee webhook integration — supports payments, extras, memberships, commissions, wishlists, refunds, cancellations
- Multi-currency with live USD/INR exchange rate
- Custom accent color with 3 saveable preset slots
- Role-based theming (ADMIN violet, DONOR amber, DEV cyan)
- Glassmorphism dark UI (`#111116` base, `#6FD1D7` default accent)
- Collapsible sidebar with context-aware settings mode
- Mobile bottom navigation bar
- In-app notification system with bell + unread count
- Form examples toggle for contextual input hints

---

## 🏗 Architecture

```mermaid
graph TB
  subgraph Client[" Client "]
    TMA[Telegram Mini App]
    Browser[Web Browser]
  end

  subgraph Sentinel[" sentinel.piratezparty.com "]
    Next[Next.js 16<br/>App Router + API Routes]
    Bot[grammY Bot<br/>Polling Mode]
  end

  subgraph External[" External Services "]
    Supabase[(PostgreSQL<br/>Supabase)]
    TG[Telegram API]
    GH[GitHub<br/>Immutable Logs]
    BMC[Buy Me a Coffee<br/>Webhooks + Sync]
    FX[Exchange Rate API]
  end

  subgraph Infra[" VPS Fleet "]
    Agent1[sentinel-agent<br/>systemd service]
    Agent2[sentinel-agent<br/>systemd service]
  end

  TMA -->|initData HMAC auth| Next
  Browser -->|JWT cookie| Next
  Next <-->|Prisma| Supabase
  Next -->|Topic logging| TG
  Next -->|Audit commits| GH
  Bot <-->|Polling| TG
  Bot -->|DM notifications| TG
  BMC -->|Webhooks| Next
  Next -->|API sync| BMC
  Next -->|USD/INR rate| FX
  Agent1 -->|Heartbeat POST /30s| Next
  Agent2 -->|Heartbeat POST /30s| Next

  classDef core fill:#0d3b45,stroke:#6FD1D7,color:#e0f7fa,stroke-width:2px
  classDef client fill:#1a1a40,stroke:#818cf8,color:#c7d2fe,stroke-width:1.5px
  classDef db fill:#14332a,stroke:#4ade80,color:#d1fae5,stroke-width:2px
  classDef telegram fill:#1c1636,stroke:#a78bfa,color:#ddd6fe,stroke-width:1.5px
  classDef extservice fill:#332010,stroke:#f59e0b,color:#fef3c7,stroke-width:1.5px
  classDef infra fill:#351515,stroke:#f87171,color:#fecaca,stroke-width:1.5px

  class Next,Bot core
  class TMA,Browser client
  class Supabase db
  class TG telegram
  class GH extservice
  class BMC extservice
  class FX extservice
  class Agent1,Agent2 infra

  style Client fill:#111128,stroke:#818cf8,stroke-width:1.5px,color:#c7d2fe
  style Sentinel fill:#0a2a30,stroke:#6FD1D7,stroke-width:2px,color:#6FD1D7
  style External fill:#1a1510,stroke:#f59e0b,stroke-width:1.5px,color:#fef3c7
  style Infra fill:#1f1010,stroke:#f87171,stroke-width:1.5px,color:#fecaca
```

### Request Flow

```mermaid
sequenceDiagram
  box rgb(17, 17, 40) Client
    participant U as User
  end
  box rgb(28, 22, 54) Telegram
    participant TG as Telegram
  end
  box rgb(10, 42, 48) Sentinel
    participant App as Next.js API
    participant Bot as grammY Bot
  end
  box rgb(20, 51, 42) Storage
    participant DB as PostgreSQL
    participant GH as GitHub Logs
  end

  U->>TG: Open Mini App
  TG->>App: initData (HMAC-SHA256)
  App->>DB: Verify user + roles
  App-->>U: JWT cookie + dashboard

  U->>App: Submit donation
  App->>DB: Create transaction (PENDING)
  App->>Bot: Notify admins (DM + group)
  Bot-->>TG: Inline keyboard → Open Sentinel

  Note over App: Admin approves
  App->>DB: Update status → APPROVED
  App->>Bot: Notify donor (DM)
  App->>GH: Immutable audit log commit
  App->>DB: Write audit entry
```

### VPS Monitoring Flow

```mermaid
sequenceDiagram
  box rgb(17, 17, 40) Client
    participant Admin as Admin Dashboard
  end
  box rgb(10, 42, 48) Sentinel
    participant API as Sentinel API
  end
  box rgb(20, 51, 42) Storage
    participant DB as PostgreSQL
  end
  box rgb(53, 21, 21) Infrastructure
    participant Agent as VPS Agent
  end

  Admin->>API: POST /api/vps (create server)
  API->>DB: Insert VpsServer + generate token
  API-->>Admin: Token (shown once)

  Note over Agent: curl install.sh | sudo bash -s -- --token XXX

  loop Every 30 seconds
    Agent->>Agent: Collect CPU, RAM, disk, network, uptime
    Agent->>API: POST /api/vps/heartbeat (Bearer token)
    API->>DB: Update metrics + lastSeen
  end

  Admin->>API: GET /api/vps
  API->>DB: Fetch servers
  Note over API: status = (now - lastSeen) > 120s ? offline : online
  API-->>Admin: Server list with live metrics
```

---

## 📂 Project Structure

```
prisma/
  schema.prisma              # 12 models, 17 enums
  seed.ts                    # Default users + 8 task tags
scripts/
  vps-agent.sh               # VPS monitoring agent (bash)
  install-agent.sh           # One-liner auto-installer
src/
  app/
    (auth)/login/            # Telegram bot-based login
    (dashboard)/
      admin/                 # 8 admin pages
        audit/               #   Audit log viewer
        credentials/         #   Credential vault
        donors/              #   Donor leaderboard
        reminders/           #   Reminder management
        services/            #   Service registry
        transactions/        #   Transaction management
        users/               #   User management
        vps/                 #   VPS monitoring
      dev/                   # Developer pages
        tasks/               #   My tasks
        gantt/               #   Archived Gantt source (route disabled)
        vps/                 #   VPS stats (read-only)
        credentials/         #   Credential access
      donor/                 # Donations + receipts
      profile/               # Settings (theme, notifications, preferences)
    api/                     # 42 API routes
      auth/                  #   Telegram auth, OTP, session, profile
      bmc/                   #   BMC webhook + sync
      credentials/           #   Vault CRUD + revision review
      donors/                #   Leaderboard
      exchange-rate/         #   Live USD/INR rate
      notifications/         #   In-app notifications
      projects/              #   Project management
      services/              #   Service registry
      reminders/             #   Reminder CRUD
      tags/                  #   Tag CRUD
      tasks/                 #   Task CRUD + my-tasks
      transactions/          #   Treasury CRUD + stats + export + approve/reject
      upload/                #   Photo upload
      users/                 #   User management
      vps/                   #   VPS CRUD + heartbeat + install + agent
  components/
    Sidebar.tsx              # Role-switching sidebar, settings context
    TopBar.tsx               # Notifications bell, settings menu
    Dropdown.tsx             # Custom dropdown
  lib/
    appreciation.ts          # 10 donor appreciation messages
    auth.ts                  # JWT (jose), session, role helpers
    bot.ts                   # grammY bot singleton
    db.ts                    # Prisma client with pg pool
    audit.ts                 # Audit entry creation
    github-log.ts            # GitHub immutable log commits
    notifications.ts         # Unified notify (in-app + TG DM with inline buttons)
    telegram-log.ts          # Group topic logging
    role-colors.ts           # Role-based color system
  bot-dev.ts                 # Standalone bot server (polling)
```

---

## Archived Features

### Gantt timeline

The developer Gantt feature is archived and unavailable in navigation, tours, and direct routing. Its implementation remains at `src/app/(dashboard)/dev/gantt/page.tsx` so it can be restored later.

To rejuvenate it:

1. Remove the `/dev/gantt` redirect in `src/middleware.ts`.
2. Restore the Gantt navigation item and icon in `src/components/Sidebar.tsx`.
3. Restore the `/dev/gantt` breadcrumb in `src/app/(dashboard)/layout.tsx`.
4. Restore the developer overview and `dev-gantt` page-tour copy in `src/lib/tour-steps.ts`.
5. Update the role and feature lists above, then run `npm run lint`, `npm test`, and `npm run build`.

---

<p align="center">
  <sub>Built for the PzP developer community</sub>
</p>
