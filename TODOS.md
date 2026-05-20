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

## Completed
