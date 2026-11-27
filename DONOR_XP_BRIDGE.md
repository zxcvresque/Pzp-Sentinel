# Sentinel → Sentry: manual donor XP review

Sentinel owns payment facts and verified Telegram identity. Sentry owns the XP ratio, reviewers, manual decisions and grant history. Every monthly charge is reviewed manually, just like a one-time donation.

## Authentication

Configure the **same** server-only `SENTRY_BRIDGE_SECRET` in both deployments. Use at least 32 random bytes (64 hex characters). Send `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` over HTTPS. Keep the value in environment variables, outside Git and browser code. Neither a Telegram bot token nor a JWT secret is the bridge credential. Sentry also needs `SENTINEL_URL=https://sentinel.piratezparty.com` (or the actual Sentinel origin).

## API contract

### List

`GET /api/sentry-bridge/donations?state=PAID%7CREVERSED&limit=100&offset=0`

- `telegramId`: optional numeric Telegram user ID. This filters by verified donor ownership, never a name, email, BMC supporter ID, or payment reference. It also returns an all-time `donor` summary (counts and separate decimal totals per currency) from the same database snapshot.
- `state`: `PAID`, `REVERSED`, or `PAID|REVERSED` (default: both).
- `from` and `to`: optional ISO timestamps with explicit timezones, both inclusive. Encode `+` as `%2B` in URLs.
- With no date filters, the API exposes the entire recorded donation history. There is no fixed start-date cutoff; `cutoff` is `null`.
- `limit`: 1–500, default 100. `offset`: 0–2,147,483,647, default 0.
- Fixed filters: `isTest=false`, `direction=IN`, `type=DONATION`, `status=APPROVED`, positive amount.
- Rows are sorted by payment date ascending, then immutable transaction ID.

```json
{
  "donations": [{
    "id": "razorpay:pay_example",
    "provider": "razorpay",
    "paymentId": "pay_example",
    "transactionId": "sentinel_transaction_id",
    "telegramId": "123456789",
    "donorKey": "telegram:123456789",
    "idempotencyKey": "sentinel:transaction:sentinel_transaction_id",
    "aliases": ["razorpay:pay_example"],
    "paymentDate": "2026-09-01",
    "paymentDateTimeZone": "UTC",
    "name": "Example donor",
    "amount": "100",
    "currency": "INR",
    "inrEstimate": "100",
    "fxRate": "1",
    "frequency": "MONTHLY",
    "occurredAt": "2026-09-01T00:00:00.000Z",
    "state": "PAID",
    "lifecycle": "ACTIVE",
    "reversalReason": null
  }],
  "limit": 100,
  "offset": 0,
  "hasMore": false,
  "nextOffset": null,
  "cutoff": null
}
```

Amounts and rates are decimal strings; Telegram IDs are strings or null. Names are display labels, never proof of identity. IDs match the canonical format in Sentinel's CSV export and legacy feed. Unmatched users stay held. Voids, refunds (including partial refunds), reversals and disputes return `REVERSED`; voids also return `lifecycle=VOIDED` and their reason.

USD rows have `inrEstimate=null` and `fxRate=null`: the ledger has no saved historical FX rate. **GET `/api/exchange-rate` remains available**, returning `rate` (INR per USD), `updatedAt`, and optionally `stale`. Sentry resolves an estimate on demand and saves it with the grant. Missing FX blocks approval. This estimate is not a historical settlement rate or actual provider net proceeds.

Each list request performs one bounded ledger-page query. When `telegramId` is supplied, currency aggregates and review/reversal counts are also read in a repeatable-read transaction, so the page and donor summary describe the same snapshot. It does not refresh the event feed, call providers, write bridge tables or drain history. Records edited between pages can shift offsets; refresh to restart. Sentry filters already reviewed donation/transaction IDs locally, so pages can be sparse; `hasMore`/`nextOffset` still work.

Follow `nextOffset` until `hasMore=false` to read all historical records. Existing verified Razorpay/BMC webhooks and admin-approved manual entries update Sentinel's ledger, and subsequent API reads immediately reflect saved additions, corrections and reversals. Sentinel can also deliver signed HTTPS notifications to a Sentry-hosted receiver; see [outbound webhook setup and contract](SENTRY_WEBHOOK.md). There is no second payment intake endpoint. A date-filtered recent-payment query alone cannot discover reversals of older payments; recheck previously awarded IDs through the detail endpoint. These APIs expose each payment's current state, not an append-only revision log. Display dates in Sentinel use DD/MM/YYYY; API timestamps remain ISO 8601.

### Single-payment live verification

`GET /api/sentry-bridge/donations/razorpay%3Apay_example`

Returns `{ "donation": { ...same fields... } }`. The path accepts a pinned donation ID, immutable `transactionId`, or a known BMC alias (original webhook or history payment/support reference). Aliases resolve to the same donation and are never extra donation records. Sentry uses the saved transaction ID to check a previous award even if its provider reference changed.

Both routes return `Cache-Control: private, no-store`. Errors: `401` missing/incorrect bearer key, `400` invalid list filters, `404` missing or currently ineligible payment, `503` failed read. A `404` blocks new approval; a previous award can be inspected for manual reversal.

## Sentry workflow

### BMC charge confirmation

`recurring_donation.started`, `recurring_donation.updated`, and membership lifecycle events describe a subscription. An `active` status, amount, or advanced `current_period_start` does not prove that a charge succeeded. Sentinel records these events and maintains donor attribution without creating income, thank-yous, reminder resets, or XP-eligible payments.

Payment webhooks must contain a successful payment result (`status=succeeded`) before creating a captured ledger entry. For all BMC donations, `bmcPaymentConfirmed` must additionally be set by a verified payment or a review against paid provider history. Existing unconfirmed BMC entries stay held for evidence review. Reconcile genuine charges before approving them in Sentry; do not bulk-confirm billing periods. If BMC supplies only subscription updates, use paid charge history or a reviewed export to reconcile the actual payments.

List, detail and legacy-feed responses separate ledger state from evidence. Only explicit voids, failed-payment corrections, refunds, reversals and disputes produce `state=REVERSED`. A missing BMC confirmation flag never proves a failure: the approved ledger row retains `state=PAID`, with `paymentConfirmed=false`, `verificationStatus=REQUIRES_REVIEW`, `xpEligible=false`, and a `reviewReason`. A known charge with a history refund awaiting review also returns `REQUIRES_REVIEW`, a `reviewReason`, and `xpEligible=false` until the correction is reviewed. An unknown later refund flag does not clear that hold. Confirmed active payments with verified Telegram attribution return `verificationStatus=CONFIRMED` and `xpEligible=true`; actual reversals return `verificationStatus=REVERSED` and `xpEligible=false`. `reversalReason` is only populated for actual reversals.

Sentry must require both `state=PAID` and `xpEligible=true` before a new award. `REQUIRES_REVIEW` must never deduct existing XP or convert a previous grant into a reversal. Keep the original transaction identity when reviewing corrections. This consumer check must also be implemented in Sentry; adding fields to Sentinel alone does not enforce its award policy. Existing incorrect XP reversals require an audited restoration in Sentry, without duplicating an award.

The [private BMC account-history integration](BMC_HISTORY_API.md) adds authenticated discovery at `/api/sentry-bridge/bmc/subscriptions` and the latest complete all-time monthly/one-time support snapshot at `/api/sentry-bridge/bmc/history`. Subscription lifecycle is separate from payment evidence: explicit cancellation/pause flags report `ACTIVE`, `PAUSED`, `CANCELLING` or `CANCELLED`; cancellation never reverses earlier paid charges. The admin connects or renews its encrypted account session inside Sentinel’s mobile/desktop website by pasting a session copied with the local Helium extractor. Checks run every 15 minutes while the bot is online and audit evidence-backed confirmations/recoveries. Ambiguous matches and explicit refunds go to review; outages/missing records retain prior evidence and never trigger automatic XP deductions. This history API is evidence, not a replacement for donation-bridge award eligibility.

An operator can preview and apply exact ledger corrections with:

```bash
node --env-file=.env scripts/reconcile-bmc-payments.mjs reviewed-manifest.json
node --env-file=.env scripts/reconcile-bmc-payments.mjs reviewed-manifest.json --apply
```

The manifest contains `userId`, `supporterId`, `reason` (the reviewed evidence), and `payments`. Every payment includes its immutable `id`, exact `bmcEventId`, `date` (`YYYY-MM-DD` in India time), decimal-string `amount`, `currency`, and `state` (`PAID` or `UNPAID`). All current ledger facts and supporter attribution must match. The atomic, idempotent correction confirms reviewed payments, voids unpaid credits, retains audits, corrects the donor's old notification, and queues bridge and finance sync updates. It cannot restore refunded/voided charges or create missing charges from a subscription schedule.

Apply the additive fields through `bash upgrade.sh`, or manually run `scripts/bmc-payment-confirmation.sql` before deploying the new app and bot, then install the updated `scripts/sentry-webhook-triggers.sql`. The Prisma schema includes these fields. Older monthly entries must be reviewed; a signed subscription event alone is not payment evidence.

### Payment review

1. Open Review queue or press Refresh to fetch one live page. Date filters include historical ledger records. There is no CSV import, feed cursor, mirror, background poll or full-history drain.
2. Preview selected grants. Only those IDs are rechecked with Sentinel, including PAID/ACTIVE status, amount, currency and verified Telegram identity.
3. Approval repeats the selected-payment check. A fingerprint rejects changed payment facts or ratio. A SQLite transaction rechecks reviewer/donor eligibility and commits XP, XP history, grant rows and audit together. Donation-ID and transaction-ID uniqueness block retries, concurrent approvals and changed-reference duplicate awards.
4. Each monthly payment uses this explicit approval flow. Monthly rules, automatic grants, reviewer claims, background reviewer DMs/digests and notification retry workers are removed.
5. Donor thank-you, audit-topic message and ordinary community XP announcement are attempted synchronously after commit. A failure is recorded in `dx_audit` and reported to the reviewer; it never rolls back/repeats the award. No outbox retry is scheduled. Reversals have no community announcement.
6. Refunds/changed details on listed awarded records appear for reversal review. In History, **Check current payment** also detects removed/ineligible records. Reviewers can deduct available XP, explicitly allow a negative balance, or waive. Original recipient, original award and requested/actual deduction are retained.
7. Correct missing/incorrect Telegram attribution in Sentinel and refresh; Sentry has no separate identity override.

The module keeps only `dx_reviewers`, `dx_grants`, `dx_audit` and `dx_settings`. The grant ledger also records rejected and reversed decisions. Donors can read only their own approved/reversed history. Permanent managers 6848424735, 458802161 and 1800754304 retain reviewer-management authority.

## Upgrade

Deploy Sentinel before Sentry. Configure the secret on both servers, rebuild Sentinel, rebuild Sentry's image and restart through the existing deployment process. Local `.env` configuration does not configure production.

Stop the old Sentry webapp before the upgrade and preserve its SQLite volume. New startup uses SQLite's backup API, migrates awards/rejections/reversal outcomes into the grant ledger, adds transaction-ID uniqueness, then removes obsolete donor tables in one transaction. Conflicting legacy transaction awards abort migration rather than deleting history. Keep the generated `*.before-manual-donor-xp-*` backup. Existing user balances and XP history are not recalculated.

This identity update requires the additive Prisma schema fields and `scripts/donation-identity.sql`. `bash upgrade.sh` installs the database guard and runs `scripts/pin-donation-identities.ts` during a brief pause of both PM2 processes after a successful build, then restarts both. The backfill preserves currently published IDs; it does not rename old donations, change their amounts, or recalculate XP. Guest checkout `/api/sentry-bridge/entry` still uses its existing bridge entry tables. Sentinel's legacy `/events` endpoint and optional provider-recovery CLI remain compatible for other consumers; Sentry no longer calls/requires them. Records missing from Sentinel's finance ledger must be recovered there before they can appear in this list.

## Verification

Sentinel: `npm test` and `npm run build`.

Sentry: `python -B -m unittest discover -s donor_xp -t . -q` and `node --check webapp/static/donor-xp.js`.

Tests use temporary SQLite databases, fake Sentinel responses and mocked Telegram delivery. They do not contact production.

After upgrading the VPS, run `npx tsx scripts/verify-donation-ledger.ts 604642404` with `SENTINEL_URL` and `SENTRY_BRIDGE_SECRET` configured there. This read-only check traverses all pages, checks that no cutoff/caching remains and verifies matching payments through the live detail API. It reports when the user has no eligible payment; it never fabricates a payment or grants XP.

## Telegram identity and repeat checks

Use `GET /api/sentry-bridge/donations?telegramId=574705248` for one Telegram user's payments. `donor.donationCount` counts approved, confirmed, active payments; `reviewCount` counts unconfirmed approved entries, and `reversedCount` counts explicit financial reversals. `totals` contains one decimal-string total per original currency. Pending historical discoveries are excluded from award candidates and can be reviewed in Sentinel's transaction queue. List pagination/date/state filters do not change the all-time summary. Two real charges by the same Telegram user remain two donations even if their amount and date match.

`telegramId` / `donorKey` identify the person. The immutable `transactionId` / `idempotencyKey` identify one payment. Names, emails, provider supporter IDs, FX estimates and timestamps must not be used as donor or award uniqueness keys. A donor's name or provider reference may change without creating a donation. An explicit donor-ownership correction changes which Telegram user owns that same transaction.

`id` is pinned in PostgreSQL. Existing IDs are preserved during deployment; new rows receive `<provider>:<transactionId>`. BMC history claims are saved separately from the original webhook reference. A database trigger rejects attempts to rename a pinned ID or attach the same BMC charge to another row, including cross-column claims. History and webhook processing share a transaction-scoped database lock across web/bot workers.

BMC dates shown in donor history, transaction views and exports use the BMC UTC calendar day and are labeled UTC. `occurredAt` retains the original ledger ISO timestamp; `paymentDate` is the source calendar date. One-time dashboard backfills have day precision, not an independently known capture time. No timezone edit changes a donation ID, amount or award eligibility.

This update prevents Sentinel metadata enrichment from emitting a second donation identity. It does not edit Sentry's stored awards or undo XP already granted twice. Consumers must treat repeated snapshots/events as upserts of the same transaction, not new grant instructions, and respect `xpEligible`.
