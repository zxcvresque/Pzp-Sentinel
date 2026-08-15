<p align="center">
  <img src="public/banner.png" alt="Sentinel — Piratezparty donation and operations hub" width="100%" />
</p>

<h1 align="center">SENTINEL</h1>

<p align="center">
  <strong>Piratezparty's private donation, treasury, developer, and infrastructure hub.</strong>
  <br />
  One Telegram-native workspace for donors, administrators, and developers.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_start-6FD1D7?style=for-the-badge&logo=rocket&logoColor=111116" alt="Quick start" /></a>
  <a href="#system-architecture"><img src="https://img.shields.io/badge/Architecture-9690D8?style=for-the-badge&logo=diagramsdotnet&logoColor=white" alt="Architecture" /></a>
  <a href="#production-deployment"><img src="https://img.shields.io/badge/Deployment-4ADE80?style=for-the-badge&logo=pm2&logoColor=111116" alt="Deployment" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111116" alt="React 19" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma" alt="Prisma 7" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Telegram-grammY-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram and grammY" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/License-Private-555?style=flat-square" alt="Private license" />
</p>

---

## What Sentinel does

Sentinel is the operating hub for Piratezparty donations and the team behind them. It combines a responsive web dashboard with [@TheSentinelRobot](https://t.me/TheSentinelRobot), PostgreSQL-backed financial records, Telegram notifications, infrastructure monitoring, and retained audit history.

The product is designed around three principles:

- **One source of truth:** financial changes originate in Sentinel and can be mirrored to Google Sheets for reporting.
- **Role-aware access:** admins, donors, and developers see different navigation, actions, and data.
- **Traceable operations:** financial mutations, credential access, broadcasts, and infrastructure actions are recorded instead of silently disappearing.

### Current highlights

- Full transaction search, pagination, filtering, sorting, editing, approval, rejection, and safe voiding.
- Checkbox selection for visible rows or the complete filtered result, with bulk approve, reject, and void actions.
- Structured confirmation dialogs, required rejection/void reasons, loading states, and per-record failure reports.
- Admin-only donor broadcasts delivered inside Sentinel, to the attached Telegram donors group, or to both.
- Matching rich text in the broadcast editor, live preview, Sentinel pop-up, notification center, and Telegram post.
- Buy Me a Coffee and server-verified Razorpay donation flows, including revocable one-time guest invitations.
- Telegram-first onboarding, alerts, donation acknowledgements, and group-topic logging.
- Encrypted credential vault, project board, GitHub activity, reminders, and live VPS telemetry.
- Mobile-first cards and navigation alongside dense desktop tables and dashboards.

## Contents

- [Roles and capabilities](#roles-and-capabilities)
- [Financial ledger](#financial-ledger)
- [Donor broadcasts](#donor-broadcasts)
- [System architecture](#system-architecture)
- [Codebase map](#codebase-map)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Integrations](#integrations)
- [VPS agent](#vps-agent)
- [Security and audit model](#security-and-audit-model)
- [Production deployment](#production-deployment)
- [Commands and verification](#commands-and-verification)

---

## Roles and capabilities

Users may hold more than one role and switch context from the responsive sidebar or mobile navigation.

| Role | Primary workspace | Capabilities |
| --- | --- | --- |
| **ADMIN** | Treasury and operations | Dashboard, transactions, donor access and guest links, broadcasts, services, API usage, credentials, VPS fleet, users, reminders, repositories, and audit history |
| **DONOR** | Piratezparty donation hub | Submit and track contributions, use enabled payment providers, view status and contribution history, receive acknowledgements and broadcasts, and configure donation reminders |
| **DEV** | Delivery and infrastructure | Kanban board, assigned tasks, service credentials, read-only VPS telemetry, and controlled SSH access requests |

### Telegram onboarding

1. Open [@TheSentinelRobot](https://t.me/TheSentinelRobot) and send `/start`.
2. An administrator approves the account and assigns the appropriate role, including `DONOR` where applicable.
3. Sentinel notifies the user after approval and exposes the matching workspace.
4. Users should keep the bot unblocked so approvals, rejections, reminders, broadcasts, and other important notices can reach them.

---

## Financial ledger

### Transaction workspace

The admin transaction screen works as a responsive card interface on mobile and a table on desktop. Editing opens in the context of the selected record instead of forcing the user back to the top of the list.

| Area | Supported behavior |
| --- | --- |
| Discovery | Server-side search across ID, description, donor/source, and creator |
| Pagination | 10, 25, 50, or 100 records per page; older records remain reachable |
| Filters | Lifecycle, status, date range, amount range, currency, direction, type, and payment method |
| Sorting | Newest, oldest, amount high-to-low, or amount low-to-high |
| Selection | Select visible rows or every matching filtered record, up to 5,000 transactions |
| Bulk actions | Approve pending records, reject with a shared reason, or void with a required reason |
| Failure handling | Reports requested, succeeded, and failed counts plus the failure for each affected record |
| Editing | Amount, currency, method, direction, type, date, description, donor/source, and up to 10 attachments (any file type, 20 MB each) |
| Reviewed records | Material edits require an explicit warning and confirmation |
| Exports and mirrors | CSV export, manual Sheets sync, and on-demand workbook backup |

### Ledger lifecycle

Sentinel separates the review status from the record lifecycle. “Delete” is implemented as a **soft void**: the transaction remains in PostgreSQL, linked audit records remain intact, and Telegram/GitHub logs are never removed by the action.

```mermaid
stateDiagram-v2
    [*] --> Pending: contribution submitted
    Pending --> Approved: admin approves
    Pending --> Rejected: admin rejects with reason
    Approved --> Approved: confirmed edit
    Rejected --> Rejected: confirmed edit

    Pending --> Voided: admin voids with reason
    Approved --> Voided: admin voids with reason
    Rejected --> Voided: admin voids with reason
    Voided --> [*]: retained outside active totals

    classDef pending fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef approved fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef rejected fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    classDef voided fill:#e2e8f0,stroke:#64748b,color:#0f172a
    class Pending pending
    class Approved approved
    class Rejected rejected
    class Voided voided
```

Voided records are excluded from active balances, donor totals, statistics, and leaderboard calculations. They remain queryable through the lifecycle filter and remain present in the Sheets transaction history for reconciliation.

### Financial event flow

```mermaid
sequenceDiagram
    actor Donor
    actor Admin
    participant UI as Sentinel UI
    participant API as Transaction API
    participant DB as PostgreSQL
    participant Audit as Audit + Telegram logs
    participant Sheets as Google Sheets mirror

    rect rgb(219, 234, 254)
        Donor->>UI: Submit contribution and proof
        UI->>API: POST /api/transactions
        API->>DB: Create PENDING transaction
        API-->>Admin: High-priority notification
    end
    rect rgb(220, 252, 231)
        Admin->>UI: Approve, reject, edit, or void
        UI->>API: Confirmed mutation
        API->>DB: Update status or void metadata
        API->>Audit: Append actor, reason, before, and after
        API-->>Donor: In-app and Telegram notification
        API-->>Sheets: Schedule mirror refresh and backup
    end
```

---

## Donor broadcasts

Only admins can open **Admin → Broadcasts** or call `/api/broadcasts`. The audience can be all donors, all developers, both groups, or individually selected active members from any of those audience views.

Each broadcast can be sent to:

- **Sentinel recipients:** a notification for the selected donor/developer audience, retained in the notification center. High priority is enabled by default and also opens the in-app pop-up plus sends a formatted personal Telegram DM to recipients who have linked and not blocked the bot.
- **Telegram donors group:** a formatted post to `TG_DONATION_GROUP_ID`, optionally inside `TG_DONATION_TOPIC_ID`.
- **Both:** one authoring action produces equivalent formatting in both destinations.

Normal-priority broadcasts remain in Sentinel's notification center without an interrupting pop-up or personal DM. Individual targeting and developer-only announcements cannot be posted to the configured donors group; this prevents a private selection or internal message from leaking into the public group. An “Everyone” broadcast may include the donors group, but developers receive it through Sentinel and, when high priority, their personal bot DM.

The title supports inline formatting and is limited to 80 characters. The message supports block and inline formatting and is limited to 3,500 characters.

| Authoring syntax | Result | Title | Message |
| --- | --- | :---: | :---: |
| `**important**` | Bold | ✓ | ✓ |
| `*emphasis*` | Italic | ✓ | ✓ |
| `__underlined__` | Underline | ✓ | ✓ |
| `~~obsolete~~` | Strikethrough | ✓ | ✓ |
| `` `literal` `` | Inline code | ✓ | ✓ |
| `[Piratezparty](https://example.com)` | Safe HTTP(S) link | ✓ | ✓ |
| `> quoted instruction` | Quote block | — | ✓ |

```mermaid
flowchart LR
    A[Admin composer] --> AUD[Audience and recipient selection]
    AUD --> P[Shared rich-text parser]
    P --> V[Live preview]
    A --> API[POST /api/broadcasts]
    API --> AUTH{Admin role?}
    AUTH -->|No| DENY[403 Forbidden]
    AUTH -->|Yes| DEST{Selected destinations}
    DEST -->|Sentinel| N[(Targeted member notifications)]
    DEST -->|Telegram| T[Donors group or topic]
    N --> POP[Donor pop-up]
    N --> BELL[Notification center]
    T --> POST[Equivalent Telegram HTML]
    API --> LOG[Audit record with delivery result]

    classDef compose fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef delivery fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef denied fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    classDef audit fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    class A,AUD,P,V,API compose
    class AUTH,DEST decision
    class N,T,POP,BELL,POST delivery
    class DENY denied
    class LOG audit
```

Telegram delivery falls back to `TG_GROUP_ID` when a separate donation group is not configured. Sending to the group requires the bot to be a member with permission to post.

---

## System architecture

```mermaid
flowchart TB
    subgraph Clients[Clients]
        MINI[Telegram Mini App]
        WEB[Desktop and mobile browser]
        ADMIN[Admin operations]
    end

    subgraph Sentinel[Sentinel application]
        MW[JWT and role middleware]
        NEXT[Next.js App Router]
        ROUTES[Route handlers]
        DOMAIN[Domain modules in src/lib]
        BOT[grammY polling bot]
    end

    subgraph Data[Persistent state]
        PG[(PostgreSQL)]
        FILES[(Telegram file storage)]
    end

    subgraph Integrations[External integrations]
        TG[Telegram Bot API]
        RZP[Razorpay API and webhooks]
        BMC[Buy Me a Coffee webhooks]
        GS[Google Sheets and Drive]
        GH[GitHub repositories and audit log]
        FX[USD/INR rate service]
    end

    subgraph Fleet[Monitored infrastructure]
        AGENT[Sentinel bash agent]
        PM2[PM2: web and bot]
    end

    MINI --> MW
    WEB --> MW
    ADMIN --> MW
    MW --> NEXT
    NEXT --> ROUTES
    ROUTES --> DOMAIN
    DOMAIN --> PG
    DOMAIN --> FILES
    ROUTES <--> RZP
    BMC --> ROUTES
    DOMAIN <--> TG
    DOMAIN --> GS
    DOMAIN --> GH
    DOMAIN --> FX
    BOT <--> TG
    BOT --> PG
    AGENT -->|heartbeat every 30 seconds| ROUTES
    PM2 --> NEXT
    PM2 --> BOT

    classDef client fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef app fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef integration fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef fleet fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class MINI,WEB,ADMIN client
    class MW,NEXT,ROUTES,DOMAIN,BOT app
    class PG,FILES data
    class TG,RZP,BMC,GS,GH,FX integration
    class AGENT,PM2 fleet
```

### Runtime boundaries

| Boundary | Responsibility |
| --- | --- |
| `src/app` | Pages, layouts, middleware-facing route groups, and server route handlers |
| `src/components` | Shared responsive UI, dialogs, navigation, payment cards, tours, and rich broadcast rendering |
| `src/lib` | Authentication, ledger queries, provider verification, notifications, encryption, logging, and integrations |
| `prisma` | PostgreSQL data model, enums, generated-client configuration, and seed/backfill utilities |
| `src/bot-dev.ts` | Long-running grammY polling process for bot commands, invitations, reminders, and alerts |
| `scripts` | Google Sheets synchronization and installable VPS telemetry agent |

### Trust boundaries

- Telegram Mini App data and Telegram Login Widget payloads are verified server-side.
- Browser sessions use signed JWT cookies and every protected API repeats role checks.
- Razorpay checkout responses are accepted only after HMAC verification and a server-side payment lookup confirms capture.
- BMC webhook deliveries are signature-verified and stored with idempotent event keys.
- Credentials and VPS secrets are encrypted before persistence; plaintext is never returned through list endpoints.
- The VPS agent authenticates heartbeats using its server token rather than a human session.

---

## Codebase map

### Directory structure

```text
Pzp-Sentinel/
├── prisma/
│   ├── schema.prisma              # Users, ledger, providers, services, tasks, audit, and VPS models
│   ├── seed.ts                    # Production-safe initial roles and task tags
│   ├── seed-qa.ts                 # QA fixtures
│   └── *backfill*.ts              # Targeted data maintenance utilities
├── public/
│   ├── banner.png                 # README/product banner
│   ├── login-bg.webp              # Desktop landing artwork
│   ├── mobile-landing-page.webp   # Mobile landing artwork
│   └── Payment Apps Icons/        # BMC, Razorpay, card, wallet, and UPI branding
├── scripts/
│   ├── install-agent.sh           # VPS agent installer and systemd provisioning
│   ├── vps-agent.sh               # CPU, memory, disk, network, load, and uptime collector
│   └── sync-finance-sheets.ts     # Manual Google Sheets mirror command
├── src/
│   ├── app/
│   │   ├── (auth)/login/          # Telegram-assisted sign-in
│   │   ├── (dashboard)/admin/     # Treasury and operations screens
│   │   ├── (dashboard)/donor/     # Donor contribution experience
│   │   ├── (dashboard)/dev/       # Board, tasks, credentials, and VPS views
│   │   ├── api/                   # Authenticated and webhook route handlers
│   │   ├── donate/[token]/        # Claimed one-time donation invitation
│   │   └── page.tsx               # Public landing page
│   ├── components/                # Shared responsive UI primitives and feature components
│   ├── generated/prisma/          # Generated Prisma client; do not hand-edit
│   ├── lib/                       # Domain and integration modules
│   ├── bot-dev.ts                 # Standalone Telegram polling process
│   └── middleware.ts              # Public allow-list, JWT validation, and role routing
├── .env.example                   # Configuration template without live secrets
├── next.config.ts                 # Next.js config and /install.sh agent rewrites
├── package.json                   # Scripts and runtime dependencies
├── start.sh / start.cmd           # Local web + bot launchers
└── upgrade.sh                     # Pull, migrate, build, restart, and verify production
```

### Module dependency map

```mermaid
flowchart LR
    subgraph Presentation[src/app and src/components]
        PAGES[Role pages]
        UI[Shared UI]
        API[API route handlers]
    end

    subgraph Domain[src/lib]
        AUTH[auth.ts]
        TX[transaction-query.ts]
        NOTIFY[notifications.ts]
        FORMAT[broadcast-format.ts]
        PAY[razorpay.ts and bmc-webhook.ts]
        VAULT[secret-crypto.ts and vps-credentials.ts]
        AUDIT[audit.ts, telegram-log.ts, github-log.ts]
        SHEETS[finance-sheets.ts]
        BOTLIB[bot.ts]
    end

    subgraph Persistence[Prisma]
        DB[db.ts]
        CLIENT[generated/prisma]
        SCHEMA[schema.prisma]
        POSTGRES[(PostgreSQL)]
    end

    PAGES --> UI
    PAGES --> API
    API --> AUTH
    API --> TX
    API --> NOTIFY
    API --> FORMAT
    API --> PAY
    API --> VAULT
    API --> AUDIT
    API --> SHEETS
    NOTIFY --> BOTLIB
    AUTH --> DB
    TX --> CLIENT
    PAY --> DB
    VAULT --> DB
    AUDIT --> DB
    SHEETS --> DB
    DB --> CLIENT
    CLIENT -. generated from .-> SCHEMA
    CLIENT --> POSTGRES

    classDef presentation fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef domain fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef persistence fill:#fef3c7,stroke:#d97706,color:#78350f
    class PAGES,UI,API presentation
    class AUTH,TX,NOTIFY,FORMAT,PAY,VAULT,AUDIT,SHEETS,BOTLIB domain
    class DB,CLIENT,SCHEMA,POSTGRES persistence
```

### Route ownership

| Route family | Owner modules | Purpose |
| --- | --- | --- |
| `/api/auth/*` | `auth.ts`, `bot.ts`, middleware | Telegram verification, OTP/login-token flow, session, logout, and profile |
| `/api/transactions/*` | `transaction-query.ts`, audit/notification/Sheets modules | Ledger CRUD, pagination, filters, selection, bulk actions, stats, and CSV export |
| `/api/broadcasts` | `broadcast-format.ts`, notifications, audit | Admin-only rich donor broadcasts |
| `/api/payments/razorpay/*` | `razorpay.ts`, `razorpay-signatures.ts`, `invite-token.ts` | Orders, capture verification, donor permissions, and guest invitations |
| `/api/bmc/*` | `bmc-webhook.ts` | Hosted-checkout config, signed webhook ingestion, and optional legacy sync |
| `/api/credentials/*` | `secret-crypto.ts` | Encrypted vault CRUD, reveal auditing, access, and review workflow |
| `/api/vps/*` | `vps-credentials.ts`, `vps-subscription.ts` | Server registry, heartbeats, agent scripts, access requests, and key upload |
| `/api/projects`, `/api/tasks`, `/api/tags` | Prisma-backed project modules | Board, assignments, subtasks, status, priority, and tags |
| `/api/integrations/google-sheets` | `finance-sheets.ts` | Manual sync, backup, and integration status |
| `/api/github/*`, `/api/tracked-repos` | GitHub activity/log modules | Repository discovery, activity, tracking, and retained log commits |
| `/api/notifications`, `/api/reminders` | `notifications.ts`, bot process | In-app notices, read state, donor nudges, and scheduled reminders |

---

## Quick start

### Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL database
- Telegram bot token from BotFather

### Install

```bash
git clone https://github.com/zxcvresque/Pzp-Sentinel.git
cd Pzp-Sentinel
npm install
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Fill in the core variables, then prepare the database:

```bash
npm run db:push
npm run db:generate
npm run db:seed
```

Start the web application and Telegram bot together:

```bash
npm run dev:all
```

Or run them in separate terminals:

```bash
npm run dev
npm run bot:dev
```

The web app defaults to `http://localhost:3000`. The bot uses polling in development and production, so do not start two bot processes with the same token.

---

## Configuration

Start from `.env.example`. Never commit `.env`, `.env.local`, service-account JSON, exported payment data, production tokens, or encryption keys.

### Core application

```env
DATABASE_URL="postgresql://user:password@host:5432/pzp_finance"
JWT_SECRET="random-secret-at-least-32-characters"
CREDENTIAL_ENC_KEY="base64-encoded-32-byte-key"
WEBAPP_URL="https://sentinel.piratezparty.com"
```

Generate the encryption key once and keep the same value for every environment sharing the database:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Changing `CREDENTIAL_ENC_KEY` makes existing encrypted credentials and VPS secrets unreadable.

### Telegram

```env
BOT_TOKEN="your-bot-token"
BOT_USERNAME="TheSentinelRobot"
BOT_WEBHOOK_SECRET="random-webhook-secret"

TG_GROUP_ID="-100xxxxxxxxxx"
TG_TOPIC_AUDIT="6"
TG_TOPIC_TRANSACTIONS="12"
TG_TOPIC_SCREENSHOTS="18"
TG_TOPIC_BACKUPS="24"

TG_DONATION_GROUP_ID="-100xxxxxxxxxx"
TG_DONATION_TOPIC_ID=""
```

`TG_DONATION_GROUP_ID` is used for donation acknowledgements and admin broadcasts. Leave `TG_DONATION_TOPIC_ID` empty to post in General. If no donation group is set, Sentinel falls back to `TG_GROUP_ID` where supported.

### Payment providers

```env
BMC_PAGE_URL="https://buymeacoffee.com/your-creator-slug"
BMC_ACCOUNT_SLUG="your-creator-slug"
BMC_WEBHOOK_SECRET="your-bmc-signing-secret"
BMC_TOKEN=""

RAZORPAY_KEY_ID="rzp_test_or_live_key_id"
RAZORPAY_KEY_SECRET="your-key-secret"
RAZORPAY_WEBHOOK_SECRET="a-separate-webhook-secret"
RAZORPAY_SUBSCRIPTION_TOTAL_COUNT="1200"
```

`BMC_TOKEN` is optional and exists only for legacy accounts that still provide API access. The configured Razorpay key ID is the source of truth for test versus live mode.

### Google and GitHub

```env
GOOGLE_SHEETS_ID="spreadsheet-id"
GOOGLE_SERVICE_ACCOUNT_EMAIL="sentinel-sheets@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

GITHUB_LOGS_TOKEN="token-for-retained-audit-log-repository"
GITHUB_TOKEN="token-for-repository-and-activity-views"
GITHUB_ORG="organization-or-username"
```

Keep the two GitHub tokens separate when they require different repository scopes.

---

## Integrations

### Donation checkout flow

```mermaid
flowchart LR
    D[Donor enters a custom amount] --> F{One time or monthly?}
    F -->|One time| O[BMC or verified Razorpay order]
    F -->|Monthly| P{Payment provider}
    P -->|BMC| B[First note links supporter]
    P -->|Razorpay| R[Plan, subscription, and mandate]
    O --> T1[Ledger and thank-you with #onetime]
    B --> T2[Recurring ledger, dated reminder, and #monthly]
    R --> T2

    classDef input fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef choice fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef provider fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef result fill:#dcfce7,stroke:#16a34a,color:#14532d
    class D input
    class F,P choice
    class O,B,R provider
    class T1,T2 result
```

### Buy Me a Coffee

Sentinel uses BMC in three ways:

1. **Hosted checkout:** the configured creator page opens in the system browser. Telegram Mini Apps use Telegram's external-link API so BMC does not run inside and slow the webview.
2. **Signed live updates:** `POST /api/bmc/webhook` verifies `x-signature-sha256`, stores the delivery, creates or updates its transaction, writes audit/Telegram logs, and refreshes the Sheets mirror.
3. **Optional legacy sync:** `POST /api/bmc/sync` is available only when `BMC_TOKEN` is configured.

Configure the BMC webhook as:

```text
https://sentinel.piratezparty.com/api/bmc/webhook
```

Enable the payment, refund, extra-purchase, recurring donation, membership, commission, and wishlist event types available to the account. Retries remain idempotent because Sentinel stores a unique event key. Test deliveries are retained for verification but excluded from live treasury totals.

Before opening BMC, an authenticated donor chooses **One time** or **Monthly** and receives a single-use Sentinel code to paste into BMC's support note. A valid first webhook binds BMC's signed `supporter_id` to that donor. Future payments—including monthly autopay updates—then remain attributed without another code. If the first note omitted the code, an admin can assign the unmatched BMC transaction to a donor in Transactions; that reconciliation creates the same trusted supporter link for later payments.

When replacing the BMC account, update `BMC_PAGE_URL`, `BMC_ACCOUNT_SLUG`, and `BMC_WEBHOOK_SECRET`, run `bash upgrade.sh`, then send a BMC test event. Previously imported transactions remain in the database, while the account slug namespaces new provider IDs to avoid collisions.

### Razorpay

For one-time payments, Sentinel creates orders server-side, verifies the checkout HMAC against the stored order, fetches the payment from Razorpay, and records a transaction only after the provider reports a captured payment. For monthly custom amounts, Sentinel creates a fixed-amount monthly Plan dynamically, creates a bounded Subscription, opens Razorpay mandate authorisation, verifies the subscription signature, and records each successful `subscription.charged` payment idempotently.

Configure the webhook as:

```text
https://sentinel.piratezparty.com/api/webhooks/razorpay
```

Subscribe to `payment.captured`, `order.paid`, `payment.failed`, and all Razorpay Subscription events—especially `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.paused`, `subscription.resumed`, and `subscription.completed`. Use a dedicated webhook secret; never reuse or expose `RAZORPAY_KEY_SECRET`.

Standard Razorpay Payment Links are one-time and fixed-amount. A fixed ₹100 `rzp.io` page therefore cannot collect a donor-selected custom amount by monthly autopay; use Sentinel's Monthly checkout, which creates the amount-specific Plan and Subscription through Razorpay's APIs.

Donor access is enforced server-side:

- BMC is enabled by default and can be disabled per donor.
- Razorpay is disabled by default and must be enabled by an admin.
- One-time guest links always offer BMC and may optionally offer Razorpay.
- An invitation is expiring, revocable, stored as a SHA-256 token hash, atomically claimed from Telegram `/start`, and consumed after a verified Razorpay capture.
- Test captures are clearly marked and excluded from production totals, burn rate, rankings, and Sheets dashboard calculations.

### Google Sheets finance mirror

Share the target workbook with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as an editor, while human viewers may remain read-only. Then initialize it with:

```bash
npm run sheets:sync
```

Sentinel generates dashboard cards, native charts, transaction rows, monthly and expense summaries, donor totals, service costs, change history, and reconciliation checks. Transaction mutations schedule a refresh; timestamped XLSX backups can be sent to `TG_TOPIC_BACKUPS`.

Sentinel remains the data-entry authority. Voided transactions remain in history but are excluded from active financial calculations.

### Telegram topics and notifications

| Destination | Content |
| --- | --- |
| Audit topic | Actor/action summaries, broadcasts, and sensitive operational events |
| Transactions topic | Created, edited, reviewed, and voided ledger records |
| Screenshots topic | Contribution proofs and submitted SSH public keys |
| Backups topic | Timestamped Google Sheets workbook snapshots |
| Donors group/topic | Donation acknowledgements and admin broadcasts |
| Direct messages | Login, approval/rejection, role, reminder, task, credential, and system notices |

High-priority financial and broadcast notices are also stored inside Sentinel. The notification bell exposes unread state and recent history.

---

## VPS agent

The lightweight bash agent collects CPU, RAM, disk, network, load average, and uptime every 30 seconds and posts them to Sentinel over HTTPS.

### Register in Sentinel, then install

1. Open **Admin → Services → VPS Stats**.
2. Add a server and copy the one-time token.
3. Run on the target Linux server:

```bash
curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- --token YOUR_TOKEN
```

The installer writes `/usr/local/bin/sentinel-agent`, creates a hardened `sentinel-agent.service`, enables it, starts it, and checks the first heartbeat.

### Self-register from a server

```bash
curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- \
  --register --api-key YOUR_ADMIN_JWT \
  --name "web-01" --platform ubuntu --provider hetzner
```

### Operate or remove the agent

```bash
journalctl -u sentinel-agent -f
systemctl status sentinel-agent
systemctl restart sentinel-agent
```

```bash
sudo systemctl disable --now sentinel-agent
sudo rm /usr/local/bin/sentinel-agent /etc/systemd/system/sentinel-agent.service
sudo systemctl daemon-reload
```

---

## Security and audit model

- **Authorization:** middleware gates page families, while route handlers independently validate the current user and required role.
- **Session integrity:** JWT verification uses `jose`; invalid or missing sessions are rejected before protected API execution.
- **Secret storage:** credentials, API account secrets, VPS passwords, and keys use AES-256-GCM encryption at rest.
- **Financial retention:** voiding records `voidedAt`, `voidedBy`, and `voidReason`; it does not delete the transaction or its audit relation.
- **Mutation evidence:** transaction create/edit/review/void events are written to PostgreSQL and mirrored to configured Telegram/GitHub log destinations.
- **Provider verification:** Razorpay HMAC/payment verification and BMC webhook signature verification happen on the server.
- **Upload handling:** proof and key uploads are constrained and routed through authenticated endpoints. Transaction attachments accept any file type up to 20 MB each, are stored beneath the persistent git-ignored `./data/transaction-attachments` directory, and require an authorized session to download.
- **Operational visibility:** bulk actions return partial failures rather than implying that every selected record succeeded.

The application log is append-oriented, but its strength still depends on production database permissions, GitHub repository protection, Telegram retention, and careful secret management.

---

## Production deployment

Sentinel runs as two PM2 processes behind the production reverse proxy:

```mermaid
flowchart LR
    USER[Browser or Telegram Mini App] --> PROXY[Nginx or Cloudflare]
    PROXY --> WEB[sentinel-web: Next.js]
    WEB --> DB[(PostgreSQL)]
    BOT[sentinel-bot: grammY polling] <--> TG[Telegram API]
    BOT --> DB
    PM2[PM2 supervisor] --> WEB
    PM2 --> BOT

    classDef edge fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef runtime fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef external fill:#ede9fe,stroke:#7c3aed,color:#3b0764
    classDef operations fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class USER,PROXY edge
    class WEB,BOT runtime
    class DB data
    class TG external
    class PM2 operations
```

### One-command upgrade

From the application directory on the VPS:

```bash
cd ~/Sentinel
bash upgrade.sh
```

`upgrade.sh` performs the complete release sequence:

1. Fetch and fast-forward `main`.
2. Install locked dependencies with `npm ci`.
3. Apply the Prisma schema with `prisma db push`.
4. Regenerate the Prisma client.
5. Remove the old `.next` bundle and build the new application.
6. Restart `sentinel-web` and `sentinel-bot`, then save the PM2 process list.
7. Verify that `/install.sh` serves the agent script instead of HTML.

The script gives the Next.js build a 3 GiB V8 heap by default because TypeScript checking can exceed Node's approximately 2 GiB default old-space limit. Override it for a larger server with:

```bash
SENTINEL_BUILD_HEAP_MB=4096 bash upgrade.sh
```

If the build still reports `JavaScript heap out of memory`, check the server's combined RAM and swap:

```bash
free -h
```

On a small VPS, provision persistent swap once before retrying. The following creates a new 4 GiB `/swapfile`; do not run it if that path already exists or the server has a different swap policy:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Then retry `bash upgrade.sh`. The script stops before PM2 restart when a build fails, so the previous compiled release keeps running.

### Manual fallback

```bash
cd ~/Sentinel
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npx prisma db push
npx prisma generate
rm -rf .next
npm run build
pm2 restart sentinel-web sentinel-bot
pm2 save
```

A plain `git pull` is not enough because production serves the compiled `.next` build. If UI changes remain stale after a successful restart, verify that Cloudflare does not cache HTML; only `/_next/static/*` should be edge-cached.

---

## Commands and verification

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run bot:dev` | Start the Telegram bot in polling mode |
| `npm run dev:all` | Start web and bot together |
| `npm run build` | Create the production Next.js bundle |
| `npm run start` | Serve the compiled Next.js bundle |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest unit suite |
| `npm run db:push` | Apply the Prisma schema to the configured database |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Seed initial data |
| `npm run db:seed:qa` | Seed QA fixtures |
| `npm run sheets:sync` | Manually refresh the finance workbook |

Before handing off a code change, run:

```bash
npm run lint
npm test
npm run build
```

Focused tests cover transaction query construction, broadcast parsing and Telegram conversion, payment signatures, provider webhook handling, invitation tokens, encryption, and Telegram escaping.

---

## Archived feature

The developer Gantt implementation remains at `src/app/(dashboard)/dev/gantt/page.tsx`, but middleware redirects `/dev/gantt` to `/dev` and navigation/tour entries are disabled. Restore the route, navigation, breadcrumb, and tour copy together if the feature is intentionally revived.

---

<p align="center">
  <strong>I stand watch.</strong>
  <br />
  <sub>Built for the Piratezparty community.</sub>
</p>
