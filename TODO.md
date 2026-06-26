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
- [ ] Update the existing production `Pzp Netcup` row back to its IPv4 address.
- [ ] Re-check 24h session persistence after production hotfix deploy.
- [ ] Verify GitHub repo/activity stats in production after tracked repos are added.
- [ ] Verify BMC sync/webhook in production.

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
