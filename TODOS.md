# TODOS

## Infrastructure

### Handle Telegram group upload failures gracefully

**What:** Check bot's group membership on proof screenshot upload. If upload fails, show clear error to donor and don't save transaction without proof.

**Why:** If the bot gets removed from the TG storage group, proof uploads silently fail. The transaction saves with no proof attached. Admin won't know until they try to view the proof image, and the donor has no idea their upload failed.

**Context:** Proof screenshots are uploaded to a designated Telegram group via bot API, storing the `file_id` in the Transaction record. The current plan has no error handling for the upload step. Wrap the TG `sendPhoto` call in try/catch. On failure: return a clear error to the donor ("Proof upload failed, please try again"). Do not create the Transaction record without a valid `proofFileId`. Consider also checking group membership at app startup or periodically.

**Effort:** S
**Priority:** P1
**Depends on:** Phase 1 file storage implementation

### Add notification delivery fallback

**What:** Wrap bot DM notifications in try/catch. If DM fails (user blocked bot), fall back to in-app notification and log the delivery failure.

**Why:** When admin approves/rejects a donation, the donor is notified via bot DM. If the donor has blocked the bot, the notification silently fails. The donor never learns their payment status changed. Admin assumes the donor was notified.

**Context:** Approval and rejection flows both trigger bot DM notifications to the donor. The Telegram Bot API returns an error when trying to send a DM to a user who blocked the bot (error code 403: "Forbidden: bot was blocked by the user"). Catch this error. Fall back to setting an in-app notification badge that the donor sees on next login. Log the failed delivery so the admin dashboard can show "notification undelivered" status.

**Effort:** S
**Priority:** P1
**Depends on:** Phase 1 approval workflow + notification system

### BMC webhook deduplication

**What:** Store BMC transaction/event ID in the Transaction record. Before creating a new transaction from a webhook, check if that BMC ID already exists.

**Why:** Buy Me a Coffee can deliver the same webhook multiple times (network retries, server timeouts). Without deduplication, each delivery creates a duplicate Transaction, inflating donation totals.

**Context:** BMC webhooks include a unique event/transaction identifier in the payload. Add a `bmcEventId` field (nullable, unique) to the Transaction model. In the webhook handler, before inserting: `findUnique({ where: { bmcEventId } })`. If found, return 200 OK without creating a duplicate. This is a standard idempotency pattern. Phase 2 item — only relevant when BMC integration ships.

**Effort:** S
**Priority:** P2
**Depends on:** Phase 2 BMC webhook integration

## QA Fixes (from 2026-05-28 exhaustive audit)

### ~~ISSUE-003: Optimize login background image~~ → WONTFIX
User wants HD image. Not an issue.

### ~~Investigate: 403 on project task endpoints~~ → FALSE POSITIVE (parallel testing artifact)
All 3 projects return 200 when tested sequentially. The 403 was caused by multiple agents sharing a browser session.

### ~~ISSUE-011: Dev Board empty columns~~ → FALSE POSITIVE
Board populates correctly with 4 tasks. Original screenshot was taken before data loaded.

### ~~ISSUE-006: Repos race condition~~ → NOT REPRODUCED
Could not reproduce in exhaustive testing. Repos loaded consistently with 35 items.

### ~~ISSUE-019: Users table overflows on mobile~~ → ALREADY FIXED
Table already had `overflow-x-auto` wrapper. Detection was false positive (measured natural table width inside scrollable container).

## Completed

### ✅ ISSUE-004: Burn Rate shows "Infinite" with no data
Changed fallback from "Infinite" to "—" when runway is null (no expense data).

### ✅ ISSUE-009: Plan page layout cramped on mobile
Added mobile media query: reduced padding, single-column kanban, tighter filter gaps below 640px.

### ✅ ISSUE-010: Add loading skeletons to page content areas
Created 6 `loading.tsx` files: admin dashboard, transactions, services, VPS, dev board, repos. All use existing `.skeleton` CSS class.

### ✅ ISSUE-008: Audit log breadcrumb inconsistency
Breadcrumb for `/admin/audit` correctly shows `"Settings / Audit Log"`, matching the sidebar's `settingsNav` hierarchy (`sectionLabel = "Settings"`, nav item `label = "Audit Log"`). Consistent with `/profile` → `"Settings / General"`. The `breadcrumbMap` entry in `layout.tsx` (line 100) is correct — no code change required.

### ✅ ISSUE-001: Fix transactions header overflow on mobile
Added `flex-wrap` to header row and filter row. Hidden divider on mobile. Zero overflow at 375px now.

### ✅ ISSUE-002: Add avatar fallback for missing images
Added `onError` state-based fallback to `TgUser.tsx`, `TopBar.tsx`, and `profile/page.tsx`. Broken images now show initials.

### ✅ ISSUE-013: Fix layout useEffect auth re-fetch on every navigation
Split into two effects: (1) fetch user once on mount `[]`, (2) derive activeRole from `[pathname, user]`. Removed `router` from deps.

### ✅ ISSUE-014: Fix bottom nav hardcoded 6-char truncation
Added `shortLabel` to NavItem interface. Labels now: Home, Txns, Svc, Donors, Donate, Board, Tasks, VPS, Creds, Repos, Remind, Gantt.

### ✅ ISSUE-015: Replace native confirm() with styled modal
Created shared `<ConfirmDialog>` component. Replaced native `confirm()` in Services, Reminders, and VPS pages.

### ✅ ISSUE-016: VPS server name truncation on desktop
Removed `truncate` class from `<h3>` in ApprovedServerCard and PendingServerCard. Full names now display.

### ✅ ISSUE-017: VPS Add Server form missing Cancel button
Added Cancel button next to "Create Server" that calls `setOpen(false)`. Ghost style, disabled during submit.

### ✅ ISSUE-018: Header icon buttons missing aria-labels
Added `aria-label="Notifications"`, `aria-label="Profile menu"`, `aria-label="Delete server"` to respective buttons.
