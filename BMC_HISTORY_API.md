# Private BMC account history and session import

Open **Sentinel → Transactions → BMC connection** (`/admin/bmc`). Sign in to your own BMC account in Helium, copy its session with the local extractor, then paste it into **Helium session → Verify and save session**. Sentinel no longer opens a browser or handles BMC login, passwords, OTPs or CAPTCHAs.

## Copy the session from Helium

1. Download `/downloads/helium-bmc-session-extractor.zip` from Sentinel's connection page and unzip it.
2. Open `chrome://extensions` in Helium, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. The browser asks for BMC cookie access; review that permission before enabling it.
3. In the same Helium window, open your signed-in BMC creator dashboard, open the extractor, and press **Copy session for Sentinel**. If you sign in through Incognito, explicitly enable **Allow in Incognito** on the extension first.
4. Paste the copied session into Sentinel and select **Verify and save session**. Clear your clipboard afterward.

The extractor runs only on a button press, reads app/studio cookies from the active BMC tab's cookie store (including HttpOnly cookies), and copies a versioned JSON credential to the clipboard. It has no background worker, network calls, local storage or telemetry. A plain console snippet using `document.cookie` cannot read HttpOnly cookies and is not a complete session extractor. Extension source is in `tools/helium-bmc-session-extractor/`; regenerate its downloadable ZIP with `python3 scripts/package-bmc-session-extractor.py` after changing it. The extension works in desktop Helium; the Sentinel paste/import form works on mobile or desktop.

**Manual alternative:** choose **Use copied request headers instead**. In Helium DevTools → Network, copy **Request Headers** (including `Cookie` and `X-XSRF-TOKEN`, if present) from a successful app request such as `https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=1`. Also copy request headers from the signed-in studio dashboard or one-time history request at `https://studio.buymeacoffee.com/transactions/supporters` or `/api/supporters/onetime`. Paste them into the corresponding app/studio fields. A raw Cookie header value is also supported. Do not paste response headers, JavaScript, or “Copy as fetch”.

## Validation and storage

The server validates the configured creator-profile link on the authenticated studio dashboard, compares nonempty first-page subscription discovery through both cookie sets, and checks one-time history access before saving anything. Mixed, expired, inaccessible, malformed or mismatched sessions leave existing credentials untouched. An account with no monthly subscriptions currently requires an alternate reviewed identity-verification method before import; the importer does not accept two empty lists as proof that sessions belong to the same creator.

The session is encrypted with AES-256-GCM in `data/bmc-dashboard/session.enc` (mode `0600`, directory creation `0700`), using `CREDENTIAL_ENC_KEY`. `BMC_DASHBOARD_SESSION_FILE` overrides the path. Web and bot processes must share the path and key. Session values never appear in API responses or logs, and the form uses no browser local storage. It clears pasted fields after a successful import. Configure `BMC_ACCOUNT_SLUG` and `WEBAPP_URL` to your creator slug and exact public Sentinel origin. Keep proxies from logging request bodies on `/api/bmc/connection`.

Successful provider requests retain provider-issued cookie rotations. If BMC invalidates the session, Sentinel retains the previous history and notifies admins to import a fresh Helium session. Disconnect removes the saved session, pauses automatic checks, and retains encrypted history/audit evidence. Existing valid sessions from older versions remain usable. Importing a session immediately queues a complete history check without needing a restart.

## VPS deployment

```bash
cd ~/Sentinel
git pull --ff-only origin main
bash upgrade.sh
```

No Playwright, Chromium install, sandbox policy, server-side browser or extension on the VPS is required. For installations where the removed browser feature was set up previously, an optional cleanup command is `bash scripts/remove-bmc-browser-setup.sh --apply`. It refuses to remove the managed browser while Chromium processes from that path are running, unloads/removes only Sentinel's dedicated AppArmor profile, and removes only the dedicated root-owned browser directory. It never removes encrypted session/history data or the operator's general browser cache.

The legacy `scripts/install-bmc-dashboard-session.mjs` remains available for per-subscription read-only API access. The new website importer is preferred for account-wide verification because it validates both origins and creator identity.

## Automatic verification

The Sentinel bot checks every 15 minutes, beginning 45 seconds after startup. **Check history now** also starts a server-side check; the phone/browser can leave the page. The scheduler discovers monthly subscriptions, including cancelled subscriptions, then fetches every renewal-history page and every one-time support page. Coverage is **monthly support and one-time support**; memberships, shop purchases, commissions and wishlist payments are outside this connector.

Subscription lifecycle is checked separately using BMC's explicit cancellation, cancel-at-period-end and pause flags. The API and connection screen report `ACTIVE`, `PAUSED`, `CANCELLING` or `CANCELLED`, plus BMC cancellation/renewal timestamps. Those lifecycle timestamps have no timezone in BMC's response and remain unmodified strings. A future renewal date is never treated as a paid charge. Status transitions after the first complete sync notify admins; existing historical cancellations appear without sending duplicate historical alerts. Cancelling does not reverse previous successful payments.

Verification fetches the entire scope before modifying any ledger entry. Inconsistent pagination, repeated rows, changed templates, expired sessions and provider outages fail closed and retain the last complete snapshot. A server-side lock prevents overlapping account checks. BMC's private endpoints are unofficial and can change.

Ledger reconciliation uses a transaction-scoped PostgreSQL advisory lock with an integer result, because Prisma cannot deserialize the lock function's native `void` result. Each payment transaction allows a 10-second acquisition wait and 20-second execution window. Sync errors include `failedStage` and, for recognized database/system errors, a safe `diagnosticCode` such as `P2010` or `P2028`; raw SQL/provider errors, cookies and connection strings are never copied into public diagnostics. The server logs these classifications so an expired session can be distinguished from a download, database or history-storage failure. After upgrading a failed verifier, select **Check history now**; a valid saved session does not need to be imported again.

An actual recorded charge can confirm an existing approved BMC donation only when its identity, amount, currency, date and donor mapping agree uniquely. Exact payment IDs take precedence; legacy matching also requires the same monthly/one-time frequency and an exact subscription or trusted supporter link, within 36 hours. Voids, rejected entries, refund/failure states, conflicting donor/reference/amounts and ambiguous candidates require review. The evidence source and charge reference are audited before confirmation. Supported INR/USD payments missing from the ledger are recovered only with a trusted supporter link and provider payment reference and no nearby possible ledger duplicate. The provider payment ID remains unique, and retries do not duplicate income. Other currencies and unmatched records remain in the history review list. Recent newly recovered donations can be announced by the existing seven-day announcement worker; older backfills are outside its lookback.

Explicit refund flags are exposed and queued for admin review, not automatically applied as ledger reversals. The comparison also flags scoped ledger payments with no match in the returned history (`LEDGER_PAYMENT_NOT_RETURNED`). Missing history, missing charge references or a subscription cancellation never automatically reverses a payment or removes XP. Previously returned charges missing on a later successful fetch are retained with a review reason; missing subscriptions retain their last known state with `missingFromLatestCheck=true` and appear as status unavailable. All review items remain accessible in the admin review section and the snapshot API's top-level `reviews` list, including ledger-only entries and older payments outside the latest 30 rows. This integration does not restore previously removed XP in PZP Sentry; that requires an audited action in Sentry.

## Server-only APIs

Use `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` for all routes below. No cookies, payer email addresses or raw provider payloads are returned. Every response is `private, no-store`.

- `GET /api/sentry-bridge/bmc/subscriptions?page=1`: live subscription discovery, lifecycle flags/status and `hasMore`; construct `page + 1` until complete. Includes active and cancelled monthly support.
- `GET /api/sentry-bridge/bmc/subscriptions/:id/history?page=1`: live paginated renewal-history evidence. Use BMC's numeric subscription ID, not Stripe `sub_...` or supporter ID. Returns `total`, `hasMore`, `nextPage` and `fetchedAt`.
- `GET /api/sentry-bridge/bmc/history?page=1`: the latest complete account snapshot, 100 payments per page, full subscription lifecycle list, coverage, sync health, freshness and per-payment review reasons. Returns 503 until a complete account sync succeeds. `stale=true` when the last check failed or the snapshot is over 30 minutes old. Previously retained missing charges carry `PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED`.

Payment fields include stable `bmc-history:<supportId>` identity, provider reference (nullable for older one-time records), amount/currency, date, frequency and evidence source. Renewal dates preserve their timezone as ISO UTC. One-time dashboard dates have day precision and are represented at UTC midnight; do not claim an exact capture time. `refundStatus` is `REFUNDED`, `NOT_REFUNDED` or `NOT_REPORTED`; null/blank flags stay unknown. `state=RECORDED` reports existence in BMC's paid-history view, not an independent Stripe PaymentIntent capture lookup.

History is evidence, **not an XP command**. Sentry should consume the existing donation bridge's `xpEligible`/verification fields, review conflicts, and reverse awards only for an explicit audited reversal/refund. An unavailable or absent history row is not evidence of failed payment.

Admin-only `GET/POST /api/bmc/connection` returns connection health and handles `import`, `sync`, and `disconnect`. Writes require an authenticated active admin, JSON, and the exact configured Sentinel Origin. An extractor import sends `{action:"import",sessionToken:"<copied JSON>"}`; manual import sends `{action:"import",appHeaders:"...",studioHeaders:"..."}`. Input is bounded; provider URLs are fixed and redirects are never followed with credentials. Removed browser-control actions return 400, and old screenshot requests return 410. No browser process is started.
