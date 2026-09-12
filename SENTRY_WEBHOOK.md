# Sentinel → Sentry HTTPS webhook

Sentinel sends signed HTTPS POST requests to a receiver hosted by Sentry. The receiver URL must be supplied by Sentry's maintainer. This implementation changes only Sentinel; it does not add a receiver to Sentry or automatically award XP.

## Setup on Sentinel

Configure the Sentinel VPS `.env`:

```dotenv
SENTRY_WEBHOOK_URL=https://YOUR-SENTRY-HOST/YOUR-RECEIVER-PATH
SENTRY_WEBHOOK_SECRET=YOUR-SHARED-SIGNING-SECRET
```

The URL above is a placeholder, not a deployed receiver. Use the actual URL supplied by the maintainer. `SENTRY_WEBHOOK_SECRET` can be omitted to reuse the existing `SENTRY_BRIDGE_SECRET`; the maintainer must use that same value to verify signatures. Never include a key in the URL. Requests use HTTPS with certificate validation for encryption in transit and HMAC-SHA256 signatures for authenticity; the secret is never sent in the webhook itself.

Run `bash upgrade.sh`. It creates the additive delivery table, installs PostgreSQL triggers and rebuilds/restarts Sentinel. If deploying manually, run `npx prisma db push`, `npx prisma db execute --file scripts/sentry-webhook-triggers.sql`, `npx prisma generate`, build and restart. The `sentinel-bot` process checks the queue every five seconds, including after restarts. A missing URL pauses delivery without discarding queued changes.

A Sentry `.env` entry alone is insufficient: its maintainer needs to implement the receiving HTTP route and signature verification. They can choose their own configuration variable names. This repository does not change Sentry.

## Incoming request at Sentry

```http
POST /YOUR-RECEIVER-PATH
Content-Type: application/json
X-Sentinel-Event-Id: 3bda2831-56bc-4a4c-beb2-c26b51b2a766
X-Sentinel-Timestamp: <Unix-seconds>
X-Sentinel-Signature: sha256=<hex HMAC>
```

```json
{
  "id": "3bda2831-56bc-4a4c-beb2-c26b51b2a766",
  "schemaVersion": 1,
  "type": "donation.changed",
  "createdAt": "2026-09-12T10:00:00.000Z",
  "observedAt": "2026-09-12T10:00:03.000Z",
  "transactionId": "sentinel-transaction-id",
  "donation": {
    "id": "manual:sentinel-transaction-id",
    "provider": "manual",
    "paymentId": "sentinel-transaction-id",
    "transactionId": "sentinel-transaction-id",
    "telegramId": "5988446905",
    "name": "Feynman",
    "amount": "1",
    "currency": "USD",
    "inrEstimate": null,
    "fxRate": null,
    "occurredAt": "2026-09-12T09:59:00.000Z",
    "frequency": "ONE_TIME",
    "state": "PAID",
    "lifecycle": "ACTIVE",
    "reversalReason": null
  }
}
```

`donation` has the same fields as the list/detail API. Manual/admin entries, Razorpay, BMC, recurring charges and recovered payments use this one outbound format. An entry first appears when it becomes an approved, positive, non-test incoming donation. Edits, provider-reference changes and donor identity corrections enqueue notifications too. Voids/refunds send `state=REVERSED` (voids also `lifecycle=VOIDED`). If a previously eligible transaction is deleted or made ineligible, the event is `donation.unavailable`, with its `transactionId` and `donation=null`.

Events are change notifications containing the current state when first prepared for delivery, not an immutable history of every intermediate payment state. Closely spaced writes may produce multiple notifications of the same final state. Queuing is atomic with the database write, including bulk operations; rollbacks leave no notification. Receipt and announcement housekeeping does not enqueue changes.

## Signature verification

Read the **raw request bytes** before JSON parsing. Calculate HMAC-SHA256 over the ASCII timestamp, a period, then those exact bytes:

```python
import hashlib
import hmac
import json
import time

def verify_sentinel(raw_body: bytes, headers, signing_secret: str):
    stamp = headers.get("x-sentinel-timestamp", "")
    signature = headers.get("x-sentinel-signature", "")
    if not stamp.isdigit() or abs(time.time() - int(stamp)) > 300:
        raise ValueError("Expired or invalid webhook timestamp")
    digest = hmac.new(
        signing_secret.encode("utf-8"),
        stamp.encode("ascii") + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, "sha256=" + digest):
        raise ValueError("Invalid webhook signature")
    event = json.loads(raw_body)
    if event.get("schemaVersion") != 1 or event.get("id") != headers.get("x-sentinel-event-id"):
        raise ValueError("Invalid webhook envelope")
    return event
```

Use case-insensitive HTTP header lookup (the example assumes framework-normalized headers). Return 401 for invalid signatures. Persist accepted events by unique `id` before returning a 2xx response; duplicate IDs should also return 2xx without repeating side effects. Delivery is at least once. Retries use the same body/ID but a fresh timestamp/signature. Keep the server clocks synchronized.

Treat `webhook.test` as diagnostic only: never create a payment or award XP. Donation notifications should update/invalidate the review view; XP approval/reversal remains manual. Notifications can arrive out of order, so use `transactionId` to retrieve the latest detail before making a decision rather than allowing an older delivery to overwrite a newer payment state. The detail API remains authoritative; a missing/ineligible record returns 404 and blocks approval.

Sentinel accepts any 2xx as acknowledgement. Timeouts, redirects and other status codes retry after 5 seconds, exponentially increasing to at most one hour, until acknowledged. Requests time out after 10 seconds. Redirects are not followed. Delivery delays do not roll back the saved payment. The delivery table retains event IDs, attempts and errors for diagnostics. There is no automatic historical webhook replay: read the full paginated API for past payments, then use notifications and detail checks for changes.

## Sentinel status and safe test URL

This is a control endpoint on **Sentinel**, not the destination for outbound notifications:

```text
https://sentinel.piratezparty.com/api/sentry-bridge/webhook
```

Authenticate using `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` (same as the history API). `GET` returns configuration/delivery counts. `GET ?eventId=<id>` reports that event's attempts, delivery timestamp and last error.

Once the actual receiving URL is configured, test a $1 USD sample for the example Telegram account from the Sentinel VPS, using the secret already in the shell environment:

```bash
curl --fail-with-body --request POST \
  'https://sentinel.piratezparty.com/api/sentry-bridge/webhook' \
  --header "Authorization: Bearer $SENTRY_BRIDGE_SECRET" \
  --header 'Content-Type: application/json' \
  --data '{"action":"test","telegramId":"5988446905"}'
```

The 202 response means **queued**, not delivered. Check the returned `eventId` via GET. The outbound body has `type="webhook.test"`, `transactionId=null`, `donation=null`, and a `test` object with `telegramId="5988446905"`, `amount="1"`, `currency="USD"`. This performs no charge, creates no ledger row and must award no XP. It exercises delivery, signature verification and receiver acknowledgement without changing finance totals.

The existing URLs continue to serve history and live verification:

```text
GET https://sentinel.piratezparty.com/api/sentry-bridge/donations
GET https://sentinel.piratezparty.com/api/sentry-bridge/donations/{transactionId}
```

Razorpay/BMC inbound webhook URLs remain provider-specific. This new outbound webhook combines their ledger results with manual donations for Sentry.
