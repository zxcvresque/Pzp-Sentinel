# Sentinel → Sentry: donor bridge

Sentinel owns payment facts and verified Telegram identity. Sentry owns XP policy (how much, minimum amounts, reviewers, grant history). Sentry uses exactly **one API** and **one webhook**:

| | What | Use |
|---|---|---|
| API | `GET /api/sentry-bridge/donations` | Read a donor (`?telegramId=`) or page through all donations |
| Webhook | Signed `POST` from Sentinel to Sentry's receiver ([format](SENTRY_WEBHOOK.md)) | Sentinel tells Sentry a donor changed, with that donor's current state |

Removed: the legacy `/api/sentry-bridge/events` feed, `/api/sentry-bridge/donations/:id`, and the raw `/api/sentry-bridge/bmc/*` endpoints. Two utility routes remain: `/api/sentry-bridge/webhook` (delivery status and a test delivery, see [SENTRY_WEBHOOK.md](SENTRY_WEBHOOK.md)) and `POST /api/sentry-bridge/entry` (creates a one-time donate link for a Telegram ID).

## Authentication

Configure the **same** server-only `SENTRY_BRIDGE_SECRET` in both deployments. Use at least 32 random bytes (64 hex characters). Send `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` over HTTPS. Keep the value in environment variables, outside Git and browser code. Sentry also needs `SENTINEL_URL=https://sentinel.piratezparty.com` (or the actual Sentinel origin).

## The API

`GET /api/sentry-bridge/donations?telegramId=123456789`

- `telegramId`: optional numeric Telegram user ID. Filters by verified donor ownership, never a name, email, BMC supporter ID, or payment reference, and adds the `donor` summary below. Use `&limit=1` if you only need the summary.
- `state`: `PAID`, `REVERSED`, or `PAID|REVERSED` (default: both).
- `from` and `to`: optional ISO timestamps with explicit timezones, both inclusive. Encode `+` as `%2B`.
- `limit`: 1–500, default 100. `offset`: 0–2,147,483,647, default 0. Follow `nextOffset` until `hasMore=false`.
- Fixed filters: `isTest=false`, `direction=IN`, `type=DONATION`, `status=APPROVED`, positive amount. Sorted by payment date, then transaction ID. No start-date cutoff (`cutoff` is `null`).
- Responses are `Cache-Control: private, no-store`. Errors: `401` bad bearer key, `400` invalid filters, `503` read failed (retry later; never treat as a removal).

```json
{
  "donations": [{
    "id": "bmc:pi_example", "provider": "bmc", "paymentId": "pi_example",
    "transactionId": "sentinel_transaction_id", "telegramId": "123456789",
    "donorKey": "telegram:123456789", "idempotencyKey": "sentinel:transaction:sentinel_transaction_id",
    "aliases": ["bmc:pi_example"], "name": "Example donor",
    "amount": "6", "currency": "USD", "inrEstimate": null, "fxRate": null,
    "occurredAt": "2026-11-16T01:18:37.000Z", "paymentDate": "2026-11-16", "paymentDateTimeZone": "UTC",
    "frequency": "MONTHLY", "state": "PAID", "lifecycle": "ACTIVE",
    "paymentConfirmed": true, "verificationStatus": "CONFIRMED", "xpEligible": true,
    "reviewReason": null, "reversalReason": null, "verification": "BMC_COMPLETE_HISTORY"
  }],
  "donor": {
    "telegramId": "123456789", "donorKey": "telegram:123456789",
    "donationCount": 4, "reviewCount": 0, "reversedCount": 0,
    "totals": [{ "currency": "USD", "amount": "24", "donationCount": 4 }],
    "bmcVerification": { "status": "VERIFIED", "upToDate": true, "unpublishedCount": 0, "issues": [],
      "lastVerifiedAt": "2026-11-28T09:00:00.000Z", "lastAttemptAt": "2026-11-28T09:00:00.000Z", "historyFetchedAt": "2026-11-28T08:59:58.000Z" },
    "autoXp": {
      "rule": "30_DAYS_PER_PAYMENT_STACKED_V1", "daysPerPayment": 30, "monthlyGraceDays": 3,
      "activeUntil": "2026-12-16T00:00:00.000Z", "graceUntil": "2026-12-19T00:00:00.000Z",
      "active": true, "inGrace": false,
      "payments": [{ "id": "bmc:pi_example", "paymentDate": "2026-11-16", "frequency": "MONTHLY", "amount": "6", "currency": "USD" }]
    }
  },
  "limit": 100, "offset": 0, "hasMore": false, "nextOffset": null, "cutoff": null
}
```

Amounts are decimal strings in the currency Sentinel received (BMC: the USD amount BMC credited, e.g. ₹2,500 → `25.85` USD). Names are display labels, never proof of identity. Voids, refunds, reversals and disputes return `state=REVERSED` (voids also `lifecycle=VOIDED`) with `reversalReason`. USD rows have `inrEstimate=null`; `GET /api/exchange-rate` returns the current INR-per-USD rate if Sentry needs an estimate.

### `donor.autoXp`

Computed by Sentinel from the donor's **verified, XP-eligible** payments only (`state=PAID`, `xpEligible=true`; BMC only after complete-history verification):

- each payment grants 30 days; a payment made before the window ends adds 30 days to it, otherwise a new window starts on its `paymentDate` (UTC day);
- if the latest payment is monthly, auto-XP stays on for 3 more days (`graceUntil`) so a renewal charged a day or two late (31-day months, retries) causes no gap;
- `active` = now < `graceUntil`; `inGrace` = between `activeUntil` and `graceUntil`. Both ends are exclusive UTC instants;
- it depends only on the payments, so it is identical however often it is read, and a late BMC verification never shortens the donor's time (it counts from the payment date);
- `payments` lists exactly what was counted, oldest first. Sentry policy such as a minimum amount is Sentry's: filter `payments` and re-run the same rule. Sentinel applies no minimum.

## What Sentry should do

1. On every webhook: verify the signature, then use its `donor` (current state, including `autoXp`). If you prefer, fetch `GET /donations?telegramId=…&limit=1` instead; it returns the same summary.
2. Every hour or so, re-read the donors you track (`?telegramId=…&limit=1`) so a missed webhook fixes itself.
3. Auto-XP is on while now < `autoXp.graceUntil`. No webhook is needed for expiry.
4. Never shorten anything because a donation is missing, a request failed (503), or `bmcVerification.status` is `BLOCKED`/`UNVERIFIED`. A refund or void arrives explicitly as `state=REVERSED` and is already reflected in `autoXp`.
5. Whether XP already claimed is taken back after a refund is Sentry's policy.

## BMC complete-history verification gate

BMC has no public payment-history API and its webhooks are not trustworthy on their own: subscription events are not charges, and a webhook can arrive for a charge BMC later refunds or never lists. Sentinel therefore never shows Sentry a BMC donation straight from the ledger.

**Flow:** complete BMC history download (every subscription's renewal pages and every one-time page, all-or-nothing) → ledger reconciliation (stamps each ledger row with the exact BMC charge it represents) → **per-donor gate** → publication → Sentry.

For each Telegram donor, the gate (`src/lib/bmc-donor-gate.ts`) compares the donor's entire BMC history (every linked supporter) with every BMC ledger row they own. It publishes only when all of these hold:

- every paid BMC charge has exactly one approved, confirmed ledger row with the same amount, currency, monthly/one-time frequency and UTC paid date, owned by this donor;
- an active BMC ledger row that is not one of those charges (an unpaid month, a duplicate, or a charge BMC has not listed yet) is **never published**; it is shown as a warning on `/admin/bmc` and does not hold the donor's real charges. It holds the donor only if Sentry was already told that row was paid (withdrawing a published payment needs a human);
- refunds reported by BMC are already voided/reversed in the ledger;
- every subscription and every previously recorded charge was returned by this check;
- per-currency totals agree, and after writing, the published rows are read back and must equal the verified totals.

If all checks pass, the donor's rows are written to `BmcBridgePublication` in **one database transaction** under the BMC advisory lock: paid charges as `state=PAID, verificationStatus=CONFIRMED, xpEligible=true`, reviewed voids as `state=REVERSED`. Each record carries `"verification": "BMC_COMPLETE_HISTORY"`. If any check fails or cannot complete, nothing about that donor changes: their last published records stay exactly as they were and the reasons are stored in `BmcDonorVerification` and shown on `/admin/bmc` (with links to the ledger entries). Other donors are unaffected.

What Sentry sees for BMC:

- **API** (`/donations`): only published BMC records. Unpublished BMC rows are absent from the list, the totals and `autoXp`. Razorpay/manual rows come from the live ledger.
- **Amounts** are what BMC credited, in the account currency (USD). A supporter paying ₹2,500.00 is published as USD 25.85, the same figure BMC's dashboard shows after the arrow. Sentinel's own pages also show what the supporter paid (`bmcSupporterAmount`/`bmcSupporterCurrency`, display only).
- **Donor summary** (`telegramId=`): totals, counts and `autoXp` combine live non-BMC rows with published BMC records. `reviewCount` is the number of this donor's BMC ledger payments not yet published. `bmcVerification` = `{ status: VERIFIED | BLOCKED | UNVERIFIED | NOT_APPLICABLE, upToDate, unpublishedCount, issues[], lastVerifiedAt, lastAttemptAt, historyFetchedAt }`.
- **Webhook**: BMC ledger writes enqueue nothing. Only an insert or a changed fingerprint in `BmcBridgePublication` enqueues a delivery (database trigger, same transaction). Unchanged re-verifications enqueue nothing. A signed BMC webhook makes Sentinel check BMC history about 30 seconds later (re-checking every 2 minutes, up to 5 times, while a just-recorded payment is not yet listed), so a verified BMC payment usually reaches Sentry within a minute or two; the 15-minute check is the backstop. A just-recorded payment is not flagged "Not in BMC records" until it has been missing from BMC's history for an hour.

Right after deployment nothing BMC is published until the first successful check (automatic within 15 minutes, or **Check history now**).

**Prove it at any time (read-only):**

```bash
npx tsx scripts/bmc-history-diagnose.ts     # can BMC history be fully downloaded? counts or the exact failed check
npx tsx scripts/bmc-gate-dry-run.ts         # per donor: would publish / held, totals, and every issue
npx tsx scripts/bmc-gate-dry-run.ts --saved # same, against the last saved complete snapshot
```

The dry run executes inside a `READ ONLY` database transaction that is rolled back, and projects the reconciliation step in memory, so it cannot change anything.

## Sentry workflow

### BMC charge confirmation

`recurring_donation.started`, `recurring_donation.updated`, and membership lifecycle events describe a subscription. An `active` status, amount, or advanced `current_period_start` does not prove that a charge succeeded. Sentinel records these events and maintains donor attribution without creating income, thank-yous, reminder resets, or XP-eligible payments.

Payment webhooks must contain a successful payment result (`status=succeeded`) before creating a captured ledger entry. For all BMC donations, `bmcPaymentConfirmed` must additionally be set by a verified payment or a review against paid provider history. Existing unconfirmed BMC entries stay held for evidence review. Reconcile genuine charges before approving them in Sentry; do not bulk-confirm billing periods. If BMC supplies only subscription updates, use paid charge history or a reviewed export to reconcile the actual payments.

List, detail and legacy-feed responses separate ledger state from evidence. Only explicit voids, failed-payment corrections, refunds, reversals and disputes produce `state=REVERSED`. A missing BMC confirmation flag never proves a failure: the approved ledger row retains `state=PAID`, with `paymentConfirmed=false`, `verificationStatus=REQUIRES_REVIEW`, `xpEligible=false`, and a `reviewReason`. A known charge with a history refund awaiting review also returns `REQUIRES_REVIEW`, a `reviewReason`, and `xpEligible=false` until the correction is reviewed. An unknown later refund flag does not clear that hold. Confirmed active payments with verified Telegram attribution return `verificationStatus=CONFIRMED` and `xpEligible=true`; actual reversals return `verificationStatus=REVERSED` and `xpEligible=false`. `reversalReason` is only populated for actual reversals.

Sentry must require both `state=PAID` and `xpEligible=true` before a new award. `REQUIRES_REVIEW` must never deduct existing XP or convert a previous grant into a reversal. Keep the original transaction identity when reviewing corrections. This consumer check must also be implemented in Sentry; adding fields to Sentinel alone does not enforce its award policy. Existing incorrect XP reversals require an audited restoration in Sentry, without duplicating an award.

The [private BMC account-history integration](BMC_HISTORY_API.md) keeps BMC's raw history inside Sentinel (Sentry reads only verified publications). Subscription lifecycle is separate from payment evidence: explicit cancellation/pause flags report `ACTIVE`, `PAUSED`, `CANCELLING` or `CANCELLED`; cancellation never reverses earlier paid charges. The admin connects or renews its encrypted account session inside Sentinel’s mobile/desktop website by pasting a session copied with the local Helium extractor. Checks run every 15 minutes while the bot is online and audit evidence-backed confirmations/recoveries. Ambiguous matches and explicit refunds go to review; outages/missing records retain prior evidence and never trigger automatic XP deductions. This history API is evidence, not a replacement for donation-bridge award eligibility.

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

After upgrading the VPS, run `npx tsx scripts/verify-donation-ledger.ts 604642404` with `SENTINEL_URL` and `SENTRY_BRIDGE_SECRET` configured there. This read-only check traverses all pages, checks that no cutoff/caching remains, and checks that `donor.autoXp` counts exactly the listed XP-eligible payments. It reports when the user has no eligible payment; it never fabricates a payment or grants XP.

## Telegram identity and repeat checks

Use `GET /api/sentry-bridge/donations?telegramId=574705248` for one Telegram user's payments. `donor.donationCount` counts approved, confirmed, active payments; `reviewCount` counts unconfirmed approved entries, and `reversedCount` counts explicit financial reversals. `totals` contains one decimal-string total per original currency. Pending historical discoveries are excluded from award candidates and can be reviewed in Sentinel's transaction queue. List pagination/date/state filters do not change the all-time summary. Two real charges by the same Telegram user remain two donations even if their amount and date match.

`telegramId` / `donorKey` identify the person. The immutable `transactionId` / `idempotencyKey` identify one payment. Names, emails, provider supporter IDs, FX estimates and timestamps must not be used as donor or award uniqueness keys. A donor's name or provider reference may change without creating a donation. An explicit donor-ownership correction changes which Telegram user owns that same transaction.

`id` is pinned in PostgreSQL. Existing IDs are preserved during deployment; new rows receive `<provider>:<transactionId>`. BMC history claims are saved separately from the original webhook reference. A database trigger rejects attempts to rename a pinned ID or attach the same BMC charge to another row, including cross-column claims. History and webhook processing share a transaction-scoped database lock across web/bot workers.

BMC dates shown in donor history, transaction views and exports use the BMC UTC calendar day and are labeled UTC. `occurredAt` retains the original ledger ISO timestamp; `paymentDate` is the source calendar date. One-time dashboard backfills have day precision, not an independently known capture time. No timezone edit changes a donation ID, amount or award eligibility.

This update prevents Sentinel metadata enrichment from emitting a second donation identity. It does not edit Sentry's stored awards or undo XP already granted twice. Consumers must treat repeated snapshots/events as upserts of the same transaction, not new grant instructions, and respect `xpEligible`.
