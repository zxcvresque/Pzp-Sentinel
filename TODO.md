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
- [ ] Commit Phase 0

## Phase 1 — core
- [ ] DB backup + dump `_CredentialAssignees` pairs → JSON (verify A/B column = credentialId vs userId)
- [ ] Edit schema (enum + CredentialAccess + Credential/User/VpsServer relations) → `npm run db:push` → `npm run db:generate`
- [ ] Write + run `prisma/backfill-cred-access.ts` (assignees→FULL/granted; VPS→linked creds, upsert on (vpsServerId,credKind))
- [ ] `src/lib/vps-credentials.ts` — `syncVpsCredentials(server, createdById)` (upsert, delete-if-empty, logCredentialAction)
- [ ] `/api/vps` POST → sync after create; PATCH approve → sync; verify DELETE cascade
- [ ] `/api/credentials` GET admin (accesses + vpsServer) · GET dev (value-omission + pendingGrants) · POST admin (accesses[], force-choice)
- [ ] `/api/credentials/[id]` PATCH (reconcile access, notify on granted false→true, VPS write-back) · DELETE (cascade)
- [ ] Access-request route — dev POST {devPublicKey}, granted:false, notifyAdmins
- [ ] `dev/vps/page.tsx` — "Request access" affordance + per-server status (none/requested/granted+own key); stats unchanged
- [ ] `admin/credentials/page.tsx` — per-dev access rows (level dropdown + granted toggle + devPublicKey + install cmd), VPS badge, send `accesses`
- [ ] `dev/credentials/page.tsx` — default empty, value optional, reveal only FULL&&granted, PUBLIC_KEY shows own key, pendingGrants block

## Phase 2 — extras
- [ ] Share-at-add-server-time (`AddServerForm` multi-select → POST `/api/vps` `shareWith[]`)
- [ ] `User.defaultSshPublicKey` + `auth/profile/route.ts`; prefill submit form
- [ ] Extract `src/lib/ssh.ts` (parsePublicKeys/shellQuote/authorizedKeysCommand); reuse in admin creds
- [ ] VPS delete-confirm copy: note it revokes linked dev access

## Verification
- [ ] db studio: CredentialAccess populated, VPS-linked creds exist, no orphans/dupes
- [ ] Run app end-to-end (see plan verification section)
- [ ] Security test: PUBLIC_KEY dev GET has no `value` key; no-grant dev gets empty list
