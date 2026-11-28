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

An actual recorded charge can confirm an existing approved BMC donation only when its identity, amount, currency, date and donor mapping agree uniquely. Exact payment IDs take precedence; legacy matching also requires the same monthly/one-time frequency and an exact subscription or trusted supporter link, within 36 hours. Voids, rejected entries, refund/failure states, conflicting donor/reference/amounts and ambiguous candidates require review. The evidence source and charge reference are audited before confirmation. Supported INR/USD payments missing from the ledger are recovered only with a trusted supporter link and provider payment reference and no nearby possible ledger duplicate. The provider payment ID and separate history claims are unique. A database guard checks references across both fields, while history and payment webhooks share a database lock. Adding history evidence never overwrites the original payment reference or the pinned bridge donation ID. Other currencies and unmatched records remain in the history review list. A missing payment older than the last complete check (or the start of the first check) is created as PENDING for review, with verified evidence, instead of becoming a new XP candidate automatically. Payments after an existing complete check can be recovered as APPROVED. Retrying a pending discovery never silently approves it.

Explicit refund flags are exposed and queued for admin review, not automatically applied as ledger reversals. The comparison also flags scoped ledger payments with no match in the returned history (`LEDGER_PAYMENT_NOT_RETURNED`). Missing history, missing charge references or a subscription cancellation never automatically reverses a payment or removes XP. Previously returned charges missing on a later successful fetch are retained with a review reason; missing subscriptions retain their last known state with `missingFromLatestCheck=true` and appear as status unavailable. All review items remain accessible in the admin review section and the snapshot API's top-level `reviews` list, including ledger-only entries and older payments outside the latest 30 rows. This integration does not restore previously removed XP in PZP Sentry; that requires an audited action in Sentry.

## Publishing to Sentry

History checks feed the per-donor publication gate described in [DONOR_XP_BRIDGE.md](DONOR_XP_BRIDGE.md#bmc-complete-history-verification-gate). Sentry receives a donor's BMC payments only after their entire history reconciles; a failed or incomplete check changes nothing that Sentry can see. `/admin/bmc` lists each donor as Verified or Held with the exact issues.

Failure messages name the failed check (endpoint, page, row and field, never payer data), for example "Failed check: one-time history page 2 row 4: multiple payment references". If BMC suddenly returns no monthly or no one-time payments although earlier checks found some, the check stops as `SESSION_EXPIRED` (a signed-out session can answer with empty lists) and nothing is changed. A one-time page that renders a sign-in prompt is also reported as `SESSION_EXPIRED`, not as a format change. HTTP 429 responses are retried up to three times, honouring `Retry-After` (capped at 30 seconds).

BMC settles every charge in the account currency (USD). A supporter paying ₹2,500.00 or €20.00 is recorded as the USD amount BMC credited ($25.85, $22.25): the one-time page's `amt` with `currency-symbol` `$`, while `psp-currency`/`converted-amt` only describe what the supporter paid. The parser checks `amt × exchange-rate = converted-amt` on every row and fails as a format change if they disagree. Monthly renewals report the same USD amount in `support_currency`. What the supporter paid in their own currency is stored on the ledger row (`bmcSupporterAmount`, `bmcSupporterCurrency`) and shown on the Transactions and donor pages as "paid ₹2,500.00 → $25.85"; it is recorded only when BMC's exchange rate proves it (a renewal row's own price can be wrong, so the subscription price is tried next), otherwise left blank.

**BMC is the source of truth, not the ledger.** After every complete check, every active BMC ledger row (webhook, recovered or manual) that no BMC charge accounts for is flagged on the row itself (`bmcReviewReason = NOT_IN_BMC_HISTORY`, audit `BMC_HISTORY_NOT_FOUND`, one admin notification per newly flagged batch). It shows as **Not in BMC records** on the Transactions and donor pages, is counted on `/admin/bmc`, and can be listed with the Transactions filter *BMC records → Not in BMC records* (`?bmcRecords=NOT_IN_BMC`). It is never sent to Sentry. Sentinel never voids it automatically. The flag clears by itself if a later check finds the charge. Rows that could be a BMC charge but are ambiguous are reported as ambiguous instead.

Monthly webhook rows carry their billing-period start in the event key (`…_period_<unix>`). History matching uses it, so a row a webhook misdated (seen: a September-period row dated 16 Aug 00:00) is never mistaken for another month's charge.

Payment webhooks are booked only when BMC explicitly states INR or USD. A missing or other currency is never assumed to be USD; the history check books such a charge with BMC's recorded currency (INR/USD) or holds it for review (other currencies).

## APIs

BMC's raw history is not exposed to Sentry. Sentry reads only verified publications, by polling `GET /api/sentry-bridge/donations` ([DONOR_XP_BRIDGE.md](DONOR_XP_BRIDGE.md)); Sentinel sends Sentry no webhooks. The former `/api/sentry-bridge/bmc/*` endpoints were removed.

Admin-only `GET/POST /api/bmc/connection` returns connection health and handles `import`, `sync`, and `disconnect`. Writes require an authenticated active admin, JSON, and the exact configured Sentinel Origin. An extractor import sends `{action:"import",sessionToken:"<copied JSON>"}`; manual import sends `{action:"import",appHeaders:"...",studioHeaders:"..."}`. Input is bounded; provider URLs are fixed and redirects are never followed with credentials. Removed browser-control actions return 400, and old screenshot requests return 410. No browser process is started.

Transient network failures and HTTP 500/502/503/504 receive up to three bounded GET attempts. Session, permission, rate-limit and missing-history errors are not blindly retried. Valid JSON is parsed even when BMC labels it `text/html`; HTML sign-in forms are classified as session expiry. Error messages identify the failed source (subscription list, monthly history, or one-time history) and HTTP status without exposing provider bodies, cookies or donor details. A failed fetch never commits partial history or changes financial records.

An explicit history refund on a known ledger payment sets an audited review hold (`bmcReviewReason=PROVIDER_REFUND_REQUIRES_REVIEW`). The donation bridge excludes it from new XP eligibility and confirmed donor totals while an admin reviews the financial correction. It does not automatically deduct an earlier award. A later unknown/omitted refund flag cannot clear the hold.

If a payment webhook lacks a Stripe charge reference, its resource ID may differ from the dashboard's support ID. A nearby BMC payment for the same verified Telegram donor causes a review hold on that receipt instead of a guessed duplicate or a second income entry. Different real payments can be approved after reviewing their charge evidence.
