# Private BMC renewal-history API

`GET /api/sentry-bridge/bmc/subscriptions/:id/history?page=1`

Send the existing server-only `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` header. This route is not a browser/donor API. It reads the signed-in creator account's dashboard endpoint at `app.buymeacoffee.com`; it is an unofficial integration, separate from BMC's legacy developer API. BMC can change this endpoint or expire the session.

Use BMC's **numeric subscription ID**, such as `1146135`, not a Stripe `sub_...` ID or a supporter ID. A private subscription-list discovery endpoint has not been implemented; obtain IDs from the creator dashboard's renewal-history request.

## Install the dashboard session

On the VPS, save the DevTools **request headers** from a successful renewal-history request to a private text file. Both two-line DevTools headers and `Cookie: ...` lines are accepted. Do not put this file in Git or paste its contents into a public ticket.

```bash
cd ~/Sentinel
node --env-file=.env scripts/install-bmc-dashboard-session.mjs /private/path/bmc-request-headers.txt
```

The installer uses the deployment's `CREDENTIAL_ENC_KEY` to encrypt the Cookie and X-XSRF-TOKEN headers with AES-256-GCM and writes `data/bmc-dashboard/session.enc`, mode `0600`. The directory is Git-ignored. `BMC_DASHBOARD_SESSION_FILE` can override the path. No restart is required to replace the session; each history request loads the current file. After installation, remove the plaintext capture from the server. Use the same installer to refresh an expired session; encryption keys must match if copying an encrypted file between hosts. Session cookies remain server-side and never appear in API responses or logs. Protect the ciphertext and the deployment encryption key.

## Response and pagination

```json
{
  "subscriptionId": "1146135",
  "payments": [{
    "id": "bmc-history:16368685",
    "supportId": "16368685",
    "subscriptionId": "1146135",
    "paymentId": "pi_example",
    "amount": "25.00",
    "currency": "USD",
    "occurredAt": "2026-11-25T16:06:23.000Z",
    "refundStatus": "NOT_REPORTED",
    "evidenceSource": "BMC_RENEWAL_HISTORY",
    "state": "RECORDED"
  }],
  "page": 1,
  "total": 1,
  "hasMore": false,
  "nextPage": null,
  "fetchedAt": "2026-11-27T00:00:00.000Z",
  "source": "BMC_DASHBOARD",
  "readOnly": true
}
```

Fetch `nextPage` until `hasMore=false`. Each call fetches exactly one bounded page; provider-supplied pagination URLs are never followed. IDs and amounts are strings. Dates preserve the provider's explicit timezone and are returned as ISO UTC. Only safe payment fields are returned; customer email, raw payloads and cookies are excluded. `refundStatus` is `REFUNDED`, `NOT_REFUNDED` or `NOT_REPORTED`. A provider refund flag produces `state=REFUNDED`; otherwise `state=RECORDED` means a row exists in BMC's renewal history. It does not claim independent Stripe capture verification, and a null refund flag is not converted into a known false flag.

## Errors and financial effects

All responses use `Cache-Control: private, no-store`. Invalid IDs/pages return 400; missing/incorrect bridge authentication returns 401. Unavailable subscription history returns 404. A missing encrypted session, expired session, access denial, rate limit or provider outage returns 503 with a machine-readable code. Changed/malformed JSON, mismatched subscription rows or inconsistent pagination returns 502. A login redirect is not followed and no session credentials are forwarded to another origin.

This endpoint writes no ledger, donor identity, XP or reversal records. It does not automatically restore Ryuzaki's XP or synchronize all subscriptions. Reconciliation must match an actual charge ID to a ledger entry and save an evidence audit before confirming a payment. Missing history, a failed request or expired session must never imply a refund, failed payment or XP deduction. An existing award must not be reversed merely because its history is temporarily unavailable.
