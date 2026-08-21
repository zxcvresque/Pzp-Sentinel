# Sentinel TODO

- [x] Fix mobile guided tour visibility on known mobile resolutions.
- [x] Add temporary QA seed data and remove it after testing.
- [x] Fix Telegram Mini App login and 24h session token max age.
- [x] Add desktop Telegram login fallback with bot confirmation button.
- [x] Fix credential pending-change mobile layout.
- [x] Push mobile tour/login fixes and updated `public/mobile-landing-page.png`.
- [x] Fix production VPS stats stale empty response with no-store fetch/API.
- [x] Fix desktop Telegram login polling so verified sessions redirect immediately.
- [x] Fix VPS card IPv6/IP address overflow on mobile and desktop.
- [x] Prevent heartbeat from overwriting the registered VPS IP address.
- [x] Prefer IPv4 detection in VPS installer/agent scripts.
- [x] Add copyable SSH command using username/IP/password context.
- [x] Add load-average health colors and a legend.
- [x] Add weekly/monthly VPS metric averages for CPU, RAM, disk, and load.
- [x] Replace runtime PNG assets with WebP assets for production.
- [x] Add labeled VPS server fields for name, username, password/key, IP, tags, SSH port, provider, and notes.
- [x] Store VPS username, SSH port, SSH key file metadata, and colored tags as first-class server data.
- [x] Collapse VPS averages behind compact pills by default.
- [x] Keep VPS SSH key uploads in Telegram with a 5MB limit.
- [x] Add dev SSH public-key storage and manual authorized_keys install command for safe VPS sharing.
- [x] Keep shared/dev VPS views free of passwords and private-key download links.
- [x] Fix: DEV role users couldn't add a Project in prod (POST /api/projects was ADMIN-only; now ADMIN||DEV, matching GET).
- [x] Fix: roles added after login (e.g. DONOR on a DEV) weren't honored — middleware reads JWT-snapshot roles; /api/auth/me now re-mints the cookie with fresh DB roles (preserving expiry).
- [x] Harden role propagation: dashboard re-fetches /api/auth/me on focus + every 2 min (re-mints cookie), and redirects users out of a section the moment their role is revoked — so demotions take effect without re-login.
- [x] Live data without reload: useAutoRefresh hook (focus + interval, no skeleton flash); applied to dev board/tasks, admin transactions, admin/dev VPS (20s), admin/donor balances, and notifications (15s).
- [x] Fix cross-account login (multi Telegram accounts on one device): Mini App initData now authoritative over stale cookie; /api/auth/me redirect only in regular browsers.
- [x] Fix admin Audit Log row overlap on mobile (responsive stack).
- [x] upgrade.sh: silence the `curl: (23)` broken-pipe noise from the install-endpoint smoke test (keep the check).
- [x] Custom donor reminders: every N days/weeks/months + time-of-day (all cadences) + per-donor timezone (default IST). Schema + /api/auth/me + DonateReminderCard + bot timing (30min poll). `prisma db push` applied to shared DB ✅; pushed.
- [x] Fix dev tasks always landing in Backlog: POST /api/projects/[id]/tasks now honors `status`; board add-form has a Status/Column selector (default To Do).
- [x] Dev task permissions ("own tasks only", no silent 403s): a dev can FULLY edit tasks they own (assigned to OR created by them) incl. status; can't touch others'; delete only for creator/admin. Admins manage all. Inline edit on /dev/tasks open (all rows are own). Gantt NaN-date guard.
- [ ] Update the existing production `Pzp Netcup` row back to its IPv4 address.
- [ ] Re-check 24h session persistence after production hotfix deploy.
- [ ] Verify GitHub repo/activity stats in production after tracked repos are added.
- [ ] Verify the signed BMC webhook in production.

---

# Financial/admin workflow consolidation (decision review before implementation)

The implementation starts only after the product choices below are confirmed. Transactions are the financial source of truth; Services, VPS, Credentials, Reminders, and provider reconciliation are contextual records/workflows around them.

## Decisions to confirm

- [ ] Confirm navigation grouping: Transactions → Ledger, Pending approvals, Reconciliation, Record transaction; Services → Catalogue, VPS, Credentials, Operational alerts.
- [ ] Confirm one service billing ledger based on linked transactions, with the first transaction optionally labelled “Initial payment”; retire separate UI treatment of `paidTxId` versus transaction history.
- [ ] Confirm composite workflow/correlation IDs so one expandable audit event can group the transaction, service, reminder, credential, receipt, and notification records created by one action.
- [ ] Select the initial Service templates and fields; keep the generic key/label/type column builder under “Advanced fields”.

## Canonical transaction and purchase flow

- [ ] Make one guided “Record transaction” flow the canonical entry point for donation/income, purchase/expense, recurring service, renewal, refund/reversal, and balance adjustment.
- [ ] In the expense branch, support no service, link an existing service, or create a service; reveal service/renewal/credential fields only when applicable.
- [ ] Preserve atomic creation of transaction + optional service + reminder + credentials + documents using one shared server-side `recordFinancialEvent` domain operation.
- [x] Remove duplicate admin creation logic: `/api/financial-events` is canonical, `/api/transactions` POST is donor-only manual proof submission, and `/api/services` POST is service-only catalogue creation. Deprecated purchase/upload routes were removed rather than retained as wrappers.
- [ ] Remove Record Purchase as a standalone Services subpage; make any “Record purchase” shortcut open the canonical transaction flow with the purchase mode preselected.
- [ ] Replace New Service → Record payment now with the canonical transaction/payment step; allow service-only creation for free, unpaid, trial, or pre-existing services.
- [ ] Add “Record payment / renewal” on Service details and prefill the canonical transaction flow with that service.
- [ ] Make the VPS billing form invoke the same service/payment workflow instead of maintaining separate financial behavior.

## Receipts and documents

- [ ] Rename the generic payment attachment prompt to “Receipt / invoice”, with a separate supporting-documents option and clear accepted-size/count guidance.
- [ ] Add receipt/invoice upload to every payment path, including New Service and renewal payments.
- [ ] Show clickable receipt filenames/previews in the transaction ledger and Service billing history instead of only an attachment count.
- [ ] Add “Upload missing receipt” / “Add receipt later” without requiring unrelated transaction edits.
- [ ] Classify documents as receipt, invoice, contract, licence, proof, or other; record uploader, upload time, related transaction/service, archive status, and audit history.
- [ ] Replace URL-array-only attachments with durable database document records while preserving existing links during migration.
- [ ] Clean up uploaded files abandoned when a form is cancelled or expires.
- [ ] Add an optional admin-configurable policy requiring receipts above a chosen expense amount.

## Transaction integrity and approvals

- [ ] Move Reconciliation under Transactions and keep “Sync Razorpay now”, unmatched BMC assignment, incomplete provider payments, and duplicate review in that workspace.
- [ ] Clearly distinguish provider-verified Razorpay/BMC payments from manual entries in forms, badges, filters, exports, and details.
- [ ] Do not offer verified provider methods as ordinary manual payment sources; route them through checkout/import/reconciliation or mark them explicitly unverified.
- [ ] Use the same approval/rejection dialog and review-note experience from Dashboard, Transactions, renewals, and Reconciliation; remove browser `prompt` approval actions.
- [ ] Keep auto-renewal deductions pending until approved; advance the service billing cycle only after approval and disable/review auto-renew on rejection.
- [ ] Present refunds as linked reversals rather than rejected payments, and keep financial lifecycle separate from administrative review state.
- [ ] Add configurable approval rules/thresholds for large expenses and optionally require a second admin when policy demands it.

## Services, credentials, reminders, and attention inbox

- [ ] Provide friendly Service templates and familiar labelled sections by default; collapse the generic custom schema builder into Advanced fields.
- [ ] Keep the global Credential Vault, but use one shared credential editor from Service, VPS, and purchase contexts with the related object preselected.
- [ ] Add a credential-delete confirmation dialog that identifies the credential and warns about linked access.
- [ ] After credential deletion, show a five-second Undo action; implement recoverable deferred/soft deletion so Undo genuinely restores the credential and access relationships, then audit delete/undo/final purge.
- [ ] Manage renewal reminder configuration from the related Service; make the global Reminders page an inbox/calendar rather than a second competing configuration flow.
- [ ] Create a unified “Needs attention” inbox for pending transaction/renewal approvals, unmatched payments, possible duplicates, missing receipts, overdue services, credential expiry, and operational alerts.
- [ ] Keep dashboard cards as summaries that deep-link to the corresponding filtered attention/transaction view instead of implementing separate action logic.
- [ ] Archive Services instead of hard-deleting them so billing, receipt, reminder, credential, and audit context remains recoverable.
- [ ] Use the shared avatar + name component everywhere a donor, creator, uploader, approver, maintainer, reminder owner, or credential accessor is shown.

## Audit and data-model cleanup

- [ ] Add a workflow/correlation ID to composite financial operations and all resulting audit records.
- [ ] Render composite audit events as a concise parent event with expandable child records and links to each affected entity.
- [ ] Consolidate Service billing around linked transactions; migrate `paidTxId` into an optional “initial payment” marker or derive it without maintaining two competing histories.
- [ ] Audit receipt upload/view/remove, approval/rejection, credential delete/undo, service archive/restore, reconciliation, and every child action in a composite workflow.

## Later enhancements after consolidation

- [ ] Add vendor/payee records, project/cost-centre allocation, budgets, receipt duplicate detection, and optional OCR-assisted receipt field extraction.
- [ ] Add drafts/autosave for longer purchase/subscription workflows.
- [ ] Add service duplicate detection/merge tools and managed category/template administration.
- [ ] QA the complete one-time purchase, new subscription, existing renewal, unpaid service, VPS billing, refund/reversal, receipt-later, reconciliation, and credential-delete undo journeys on desktop and mobile.

---

# VPS↔Credentials sharing (active feature)

Plan: `C:\Users\varad\.claude\plans\credentials-and-vps-stats-expressive-tower.md` · Working protocol: `superclaude.md`

## Phase 0 — working system
- [x] Create `superclaude.md`, trim `CLAUDE.md`, create `plan.md`, append this checklist, create `.claude/worklog.md`
- [x] Commit Phase 0

## Phase 1 — core
- [x] DB backup + dump `_CredentialAssignees` pairs → JSON (table was EMPTY: 0 creds, 0 pairs; only an empty join table dropped → no data loss)
- [x] Edit schema (enum + CredentialAccess + Credential/User/VpsServer relations) → `db push` (--accept-data-loss) → `generate` ✅
- [x] Write + run `prisma/backfill-cred-access.ts` (0 pairs; 1 VPS server → 1 linked "Root Password" credential)
- [x] `src/lib/vps-credentials.ts` — `syncVpsCredentials(server, createdById)` (upsert, delete-if-empty, logCredentialAction)

### Security hardening (mid-build)
- [x] `src/lib/secret-crypto.ts` (AES-256-GCM, `enc:v1:` format, fail-closed encrypt, legacy plaintext passthrough); `CREDENTIAL_ENC_KEY` in `.env` + `.env.example`
- [x] Encrypt write paths (syncVpsCredentials) + one-time `prisma/encrypt-existing-secrets.ts` (encrypted 1 cred + 1 server)
- [x] Telegram audit mirror: `logCredentialAction` → also `logAuditEvent` (TG_TOPIC_AUDIT); emoji map extended. Never re-sends SSH file.
- [ ] Audited **reveal** chokepoint endpoint (with PATCH below)

### Remaining Phase 1 — ALL DONE ✅ (production build passes)
- [x] `/api/vps` POST sync after create; PATCH approve sync; encrypt password/sshKeyFileUrl; admin GET decrypt; DELETE cascade verified
- [x] `/api/credentials` GET admin (accesses + vpsServer, decrypt) · GET dev (NO value + pendingGrants) · POST (accesses[], force-choice, encrypt)
- [x] `/api/credentials/[id]` PATCH (reconcile access, notify on grant, VPS write-back) · DELETE (cascade) · review unchanged
- [x] `/api/credentials/[id]/reveal` — audited decrypt chokepoint
- [x] `/api/vps/[id]/request-access` — dev submits key, granted:false, notifyAdmins
- [x] `dev/vps/page.tsx` — SshAccessPanel (none/requested/granted + own key)
- [x] `admin/credentials/page.tsx` — per-dev access rows, grant toggle, install cmd, VPS badge
- [x] `dev/credentials/page.tsx` — default empty, reveal-on-demand, pendingGrants block

## Phase 2 — extras
- [x] Share-at-add-server-time (`AddServerForm` multi-select → POST `/api/vps` `shareWith[]`, FULL granted + notify)
- [x] VPS delete-confirm copy: warns linked vault creds + dev access removed
- [ ] DEFERRED (low value, ask user): `User.defaultSshPublicKey` prefill (dev already sees stored key; needs another migration + cross-page plumbing)
- [ ] DEFERRED (no user-facing value): extract `src/lib/ssh.ts` refactor

## Verification — ALL PASS ✅
- [x] DB spot-check: linked cred encrypted (enc=true, VPS_PASSWORD, decrypts OK); VpsServer.password encrypted at rest
- [x] `tsc --noEmit` clean + `npm run build` passes (exit 0)
- [x] Security tests: secret-crypto round-trip / tamper / passthrough (6 pass)
- [ ] OPTIONAL manual run: log in as admin + dev and click through the flows
- [ ] PROD: set `CREDENTIAL_ENC_KEY` env in production before deploy (fail-closed without it)

---

# VPS Plan/Duration → Services (active feature)

Compact + pill-ified VPS card; admin-only Plan Link + Duration that mirror into the Services/subscriptions tab and deduct from current balance.

- [x] Schema: `Frequency.WEEKLY`; `Service.autoRenew` + `Service.vpsServer`/`vpsServerId` (`@unique`, onDelete SetNull); `VpsServer.planLink` + `subscription` relation. `db push --accept-data-loss` (new-column unique only) + generate.
- [x] `src/lib/vps-subscription.ts` — `syncVpsSubscription()` (upsert Service, first-attach deduct as APPROVED OUT SUBSCRIPTION tx, paidTxId link) + `nextCycleDate()`.
- [x] `/api/vps` — POST accepts `planLink`+`duration`; PATCH `action:"update"` (edit; blank secret = keep) + `action:"renew"` (manual cycle); GET includes `subscription`/`planLink` **admin-only**.
- [x] `src/bot-dev.ts` — `checkSubscriptionRenewals()` daily; auto-renew due subs → OUT tx + advance expiry.
- [x] Admin card redesign: compact (gap-3, p-5), status/platform/duration/load **pills**, Platform highlighted, Plan link, Renew-now, Edit flow via shared `ServerForm` (add+edit).
- [x] Dev card: compact + platform/status pills, **no billing** (devs never see plan/duration — user requirement).
- [x] Services page: `VPS` + `Auto-renew` badges on linked rows; WEEKLY burn math (client + stats route).
- [x] Verify: tsc clean, vitest 6/6, `npm run build` exit 0.
- [ ] Manual/QA: edit Pzp Netcup → add Monthly sub + Renew → confirm Services row + APPROVED OUT tx + balance drop; Lifetime one-time; toggle auto-renew off; delete VPS keeps Service+tx.
- [ ] Not committed/pushed (awaiting user).
