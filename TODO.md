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
