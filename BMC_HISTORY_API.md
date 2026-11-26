# Private BMC account history and connection

Open **Sentinel → Transactions → BMC connection** (`/admin/bmc`) on a phone or computer. Admins can open an isolated, server-hosted Incognito browser, complete BMC email login/OTP/verification, and select **Connect account**. No extension, desktop helper, copied cookie or CSV is needed.

The browser is controlled inside Sentinel through screenshots, taps, text entry and keyboard controls. Every login starts with a new non-persistent browser context, closes after 15 minutes, and is accessible only to the admin who opened it. External sign-in popups are unavailable; use BMC email login. Sentinel never solves verification challenges or saves passwords. BMC may reject a hosted browser; the connection screen reports failures rather than claiming a successful connection.

## VPS deployment

```bash
cd ~/Sentinel
bash upgrade.sh
```

The upgrade installs the pinned Playwright dependency, Chromium and its Linux dependencies, checks browser startup, then builds/restarts Sentinel. Linux dependency installation may invoke sudo. Run PM2 as the same non-root user who runs the upgrade. Chromium must have sandbox support; the app does not fall back to `--no-sandbox`. An existing compatible Chromium can be selected with `BMC_CHROMIUM_EXECUTABLE`.

Ubuntu's AppArmor user-namespace restriction can block a downloaded Chromium even after a successful installation. The connection API reports `BROWSER_SANDBOX_BLOCKED` separately from missing browsers or Linux libraries. Run `node scripts/check-bmc-browser.mjs` as the PM2 user for a startup check. The one-time scoped setup is:

```bash
node scripts/setup-bmc-browser.mjs          # preview the exact system changes
node scripts/setup-bmc-browser.mjs --apply  # administrator-reviewed setup; uses sudo
```

This copies the pinned Chromium into a versioned, root-owned tree under `/opt/sentinel-bmc-browser/`, strips setuid/setgid and group/other write bits, and installs `/etc/apparmor.d/sentinel-bmc-browser`. Only Chromium executables inside that protected tree receive `userns` permission; the profile follows [Chromium's documented AppArmor approach](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). It does not grant blanket namespace access to user-writable browser caches, disable AppArmor globally, or disable Chromium's sandbox. The app automatically selects the matching managed browser revision. Retry connecting after setup; rerun it after a Playwright revision update if the sandbox check requests it. Rollback: stop private login sessions, unload the profile with `sudo apparmor_parser -R /etc/apparmor.d/sentinel-bmc-browser`, and remove the profile/managed installation after reviewing their contents.

Configure the existing `BMC_ACCOUNT_SLUG`, `WEBAPP_URL` (the exact public Sentinel origin), and `CREDENTIAL_ENC_KEY`. The account must match the creator-profile link on the authenticated BMC dashboard. Sessions and history are stored with AES-256-GCM in the Git-ignored `data/bmc-dashboard/` directory, mode `0600`; directory creation uses `0700`. `BMC_DASHBOARD_SESSION_FILE` can relocate the session and its sibling history/health files. Web and bot processes must share this path and encryption key. Use a single PM2 web process; the interactive login browser is held in process memory and does not support multi-instance load balancing.

Saved session cookies remain server-side. The browser closes once the session is validated/saved. Successful provider requests retain provider-issued cookie rotations. If BMC invalidates the session, Sentinel keeps the previous complete history, marks verification unavailable, and notifies admins once per error transition. Reconnect from Sentinel; no password or OTP is replayed automatically. Disconnect removes the saved session and pauses further checks. Previously fetched history and audit evidence remain encrypted on the server.

The legacy `scripts/install-bmc-dashboard-session.mjs` installer still supports read-only, per-subscription history requests for existing operators. Automatic account-wide verification requires the new in-app connection, including studio cookies and verified creator identity.

## Automatic verification

The Sentinel bot checks every 15 minutes, beginning 45 seconds after startup. **Check history now** also starts a server-side check; the phone/browser can leave the page. The scheduler discovers monthly subscriptions, including cancelled subscriptions, then fetches every renewal-history page and every one-time support page. Coverage is **monthly support and one-time support**; memberships, shop purchases, commissions and wishlist payments are outside this connector.

Subscription lifecycle is checked separately using BMC's explicit cancellation, cancel-at-period-end and pause flags. The API and connection screen report `ACTIVE`, `PAUSED`, `CANCELLING` or `CANCELLED`, plus BMC cancellation/renewal timestamps. Those lifecycle timestamps have no timezone in BMC's response and remain unmodified strings. A future renewal date is never treated as a paid charge. Status transitions after the first complete sync notify admins; existing historical cancellations appear without sending duplicate historical alerts. Cancelling does not reverse previous successful payments.

Verification fetches the entire scope before modifying any ledger entry. Inconsistent pagination, repeated rows, changed templates, expired sessions and provider outages fail closed and retain the last complete snapshot. A server-side lock prevents overlapping account checks. BMC's private endpoints are unofficial and can change.

An actual recorded charge can confirm an existing approved BMC donation only when its identity, amount, currency, date and donor mapping agree uniquely. Exact payment IDs take precedence; legacy matching also requires the same monthly/one-time frequency and an exact subscription or trusted supporter link, within 36 hours. Voids, rejected entries, refund/failure states, conflicting donor/reference/amounts and ambiguous candidates require review. The evidence source and charge reference are audited before confirmation. Supported INR/USD payments missing from the ledger are recovered only with a trusted supporter link and provider payment reference and no nearby possible ledger duplicate. The provider payment ID remains unique, and retries do not duplicate income. Other currencies and unmatched records remain in the history review list. Recent newly recovered donations can be announced by the existing seven-day announcement worker; older backfills are outside its lookback.

Explicit refund flags are exposed and queued for admin review, not automatically applied as ledger reversals. The comparison also flags scoped ledger payments with no match in the returned history (`LEDGER_PAYMENT_NOT_RETURNED`). Missing history, missing charge references or a subscription cancellation never automatically reverses a payment or removes XP. Previously returned charges missing on a later successful fetch are retained with a review reason; missing subscriptions retain their last known state with `missingFromLatestCheck=true` and appear as status unavailable. All review items remain accessible in the admin review section and the snapshot API's top-level `reviews` list, including ledger-only entries and older payments outside the latest 30 rows. This integration does not restore previously removed XP in PZP Sentry; that requires an audited action in Sentry.

## Server-only APIs

Use `Authorization: Bearer <SENTRY_BRIDGE_SECRET>` for all routes below. No cookies, payer email addresses or raw provider payloads are returned. Every response is `private, no-store`.

- `GET /api/sentry-bridge/bmc/subscriptions?page=1`: live subscription discovery, lifecycle flags/status and `hasMore`; construct `page + 1` until complete. Includes active and cancelled monthly support.
- `GET /api/sentry-bridge/bmc/subscriptions/:id/history?page=1`: live paginated renewal-history evidence. Use BMC's numeric subscription ID, not Stripe `sub_...` or supporter ID. Returns `total`, `hasMore`, `nextPage` and `fetchedAt`.
- `GET /api/sentry-bridge/bmc/history?page=1`: the latest complete account snapshot, 100 payments per page, full subscription lifecycle list, coverage, sync health, freshness and per-payment review reasons. Returns 503 until a complete account sync succeeds. `stale=true` when the last check failed or the snapshot is over 30 minutes old. Previously retained missing charges carry `PREVIOUSLY_RECORDED_PAYMENT_NOT_RETURNED`.

Payment fields include stable `bmc-history:<supportId>` identity, provider reference (nullable for older one-time records), amount/currency, date, frequency and evidence source. Renewal dates preserve their timezone as ISO UTC. One-time dashboard dates have day precision and are represented at UTC midnight; do not claim an exact capture time. `refundStatus` is `REFUNDED`, `NOT_REFUNDED` or `NOT_REPORTED`; null/blank flags stay unknown. `state=RECORDED` reports existence in BMC's paid-history view, not an independent Stripe PaymentIntent capture lookup.

History is evidence, **not an XP command**. Sentry should consume the existing donation bridge's `xpEligible`/verification fields, review conflicts, and reverse awards only for an explicit audited reversal/refund. An unavailable or absent history row is not evidence of failed payment.

Admin-only `GET/POST /api/bmc/connection` handles health, the owner-bound private browser and sync requests. Writes require an authenticated active admin and the exact configured Sentinel Origin; input, destinations and keyboard actions are bounded. The browser has no arbitrary URL or JavaScript-execution control, accepts no downloads, blocks external top-level navigation and common destructive account/payment routes, and closes external popups. Login screenshots and text are never persisted or logged by the application; keep reverse proxies configured not to log request/response bodies on this route.
