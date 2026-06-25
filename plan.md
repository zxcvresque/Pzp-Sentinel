# Plan: VPS secrets → Credentials vault + per-dev sharing

Full plan: `C:\Users\varad\.claude\plans\credentials-and-vps-stats-expressive-tower.md`

## Goal
When an admin adds a VPS server, its secrets (root password, SSH private key) auto-become **linked Credential records**. Dev access is governed by the Credentials system with two modes per dev:
- **PUBLIC_KEY** (normal VPS path): dev submits *their own* SSH public key → admin installs it on the box out-of-band → flips `granted`. Dev sees only their own submitted key, never the password/private key.
- **FULL**: dev can reveal the actual secret value (rare).

## Confirmed decisions
- **Default visibility:** VPS *stats* stay open to all devs (unchanged). *Credentials* default to **hidden** — dev requests access from the VPS card by pasting an SSH public key.
- Access mode is **force-choice** (no default; admin picks each share).
- **No 2FA** anywhere.
- Dev SSH key stored **per-grant** on the access row.
- Public-key access is **server-scoped** (one request → access rows for that server's linked creds, grouped in UI).

## Key technical facts
- Migrations via `prisma db push` (no migrations dir); backfill via `npx tsx`.
- `Credential.assignees` is an implicit M2M (`_CredentialAssignees`) — **`db push` drops it; dump first.**
- Prisma client → `src/generated/prisma`; enums from `@/generated/prisma/enums`.
- Dev VPS GET already strips secrets via `...(isAdmin ? {...} : {})` — reuse for credential value omission.
- VPS secret columns stay source of truth (heartbeat token, admin SSH/sshpass/authorized_keys builders read them); linked creds are a synced view with guarded write-back.
- `Credential.createdById` required vs `VpsServer.addedById` nullable → fallback admin id.
- Reuse: `notify`/`notifyAdmins`/`formatTgMessage`, `logCredentialAction`/`logApproval`, `getCurrentUser`/`hasRole`, `parsePublicKeys`/`shellQuote`/`authorizedKeysCommand`.

## Schema (prisma/schema.prisma)
- New `enum CredAccessLevel { PUBLIC_KEY FULL }` (no `@default` — force-choice).
- New `model CredentialAccess { id, credentialId, userId, accessLevel, devPublicKey?, granted, grantedAt?, timestamps; @@unique([credentialId,userId]); @@index([userId]) }`.
- `Credential`: drop `assignees`; add `accesses`, `vpsServerId?`, `vpsServer?`, `credKind?` ("VPS_PASSWORD"|"VPS_SSH_KEY"), `@@index([vpsServerId])`.
- `User`: `credentialAccess CredentialAccess[] @relation("CredAccessUser")`.
- `VpsServer`: add `credentials Credential[]`. Keep secret columns. No 2FA.

## Value-omission invariant
A dev response includes `value` **only when `accessLevel === FULL && granted === true`**. PUBLIC_KEY: never `select` value into the object (server-side, not UI).

See `todo.md` for the live checklist and `.claude/worklog.md` for progress.
