# Sentinel → Sentry: manual donor XP review

Sentinel owns payment facts and verified Telegram identity. Sentry owns the XP ratio, reviewers, manual decisions and grant history. Every monthly charge is reviewed manually, just like a one-time donation.

## Authentication

Configure the **same** server-only `SENTRY_BRIDGE_SECRET` in both deployments. Use at least 32 random bytes (64 hex characters). Send `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` over HTTPS. Keep the value in environment variables, outside Git and browser code. Neither a Telegram bot token nor a JWT secret is the bridge credential. Sentry also needs `SENTINEL_URL=https://sentinel.piratezparty.com` (or the actual Sentinel origin).

## API contract

### List

`GET /api/sentry-bridge/donations?state=PAID%7CREVERSED&limit=100&offset=0`

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

Each list request performs one bounded ledger query. It does not refresh the event feed, call providers, write bridge tables or drain history. Records edited between pages can shift offsets; refresh to restart. Sentry filters already reviewed donation/transaction IDs locally, so pages can be sparse; `hasMore`/`nextOffset` still work.

Follow `nextOffset` until `hasMore=false` to read all historical records. Existing verified Razorpay/BMC webhooks and admin-approved manual entries update Sentinel's ledger, and subsequent API reads immediately reflect saved additions, corrections and reversals. Sentinel can also deliver signed HTTPS notifications to a Sentry-hosted receiver; see [outbound webhook setup and contract](SENTRY_WEBHOOK.md). There is no second payment intake endpoint. A date-filtered recent-payment query alone cannot discover reversals of older payments; recheck previously awarded IDs through the detail endpoint. These APIs expose each payment's current state, not an append-only revision log. Display dates in Sentinel use DD/MM/YYYY; API timestamps remain ISO 8601.

### Single-payment live verification

`GET /api/sentry-bridge/donations/razorpay%3Apay_example`

Returns `{ "donation": { ...same fields... } }`. The path accepts a canonical donation ID or immutable `transactionId`. Sentry uses the saved transaction ID to check a previous award even if its provider reference changed.

Both routes return `Cache-Control: private, no-store`. Errors: `401` missing/incorrect bearer key, `400` invalid list filters, `404` missing or currently ineligible payment, `503` failed read. A `404` blocks new approval; a previous award can be inspected for manual reversal.

## Sentry workflow

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

The new list/detail API requires no PostgreSQL migration. Guest checkout `/api/sentry-bridge/entry` still uses its existing bridge entry tables. Sentinel's legacy `/events` endpoint and optional provider-recovery CLI remain compatible for other consumers; Sentry no longer calls/requires them. Records missing from Sentinel's finance ledger must be recovered there before they can appear in this list.

## Verification

Sentinel: `npm test` and `npm run build`.

Sentry: `python -B -m unittest discover -s donor_xp -t . -q` and `node --check webapp/static/donor-xp.js`.

Tests use temporary SQLite databases, fake Sentinel responses and mocked Telegram delivery. They do not contact production.

After upgrading the VPS, run `npx tsx scripts/verify-donation-ledger.ts 604642404` with `SENTINEL_URL` and `SENTRY_BRIDGE_SECRET` configured there. This read-only check traverses all pages, checks that no cutoff/caching remains and verifies matching payments through the live detail API. It reports when the user has no eligible payment; it never fabricates a payment or grants XP.
