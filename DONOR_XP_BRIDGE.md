# Sentinel → Sentry donor XP bridge

## What this implementation does

Sentinel remains responsible for checkout, payment verification and Telegram identity. Sentry owns XP policy, reviewer permissions, approvals, monthly rules, history and notifications. Neither bot reads the other bot's Telegram messages. There is no test-account allowlist or Telegram bot-to-bot-mode dependency.

**Chosen historical workflow:** export transactions from **Sentinel**, then paste/upload that export in **Sentry** and review the pending XP. No BMC/Razorpay file import or direct provider-history sweep is required for transactions already recorded in Sentinel. The optional provider tools below are only for recovering records missing from Sentinel, not an extra step for this workflow. Server setup is one-time deployment work; the shared secret also supports the continuous new-payment feed and verification of imported rows.

### Continuous payment path

1. Existing signature-verified Razorpay/BMC webhooks and checkout verification save the finance transaction in Sentinel. Admin-approved manual donations also qualify.
2. Sentry requests Sentinel's authenticated `/api/sentry-bridge/events?after=<cursor>` roughly every five seconds. Sentinel snapshots eligible finance records and provider reconciliation records into an append-only PostgreSQL event ledger. Changes, including voids/refunds, become new events. This also catches transactions committed just before a process restart, without requiring an in-memory notification to survive.
3. Sentry stores each batch and its cursor in one SQLite transaction. On restart it continues from that cursor. Feed requests are uncached and use a server-only bearer secret over HTTPS.
4. New grants remain pending. XP, XP history, the approval ledger and notification-outbox entries commit atomically. Duplicate payment IDs and repeat/concurrent approvals do not re-credit XP. A secondary Sentinel transaction-ID check prevents crediting the same ledger entry under a changed payment reference.
5. Telegram notifications run independently of ingestion. Failed deliveries retry with backoff; the health panel exposes failures and a retry action. The reviewer page checks for new activity every five seconds without overwriting unsaved edits.
6. Optionally, the separate `bridge:watch` process reconciles provider history every five minutes, catching Razorpay payments missed by webhooks. It is not needed for Sentinel CSV import or the normal live ledger feed. Polling is best effort, not a guaranteed five-second SLA.

Manual approval/preview and CSV import first catch up with Sentinel and fail closed if it is unavailable. Monthly automation runs only after the full feed backlog is drained, so a refund on a later page is not skipped. No live provider calls or production writes are performed by the unit tests.

### Review and donor features

- Permanent managers: **6848424735**, **458802161**, **1800754304**. Only those three can add/remove delegated reviewers. Reviewers gain donor-XP access, not general Sentry admin authority. Removing a reviewer releases their claims, stops their queued DMs and pauses their monthly rules.
- Individual or hourly digest DMs; the pending queue remains available in either mode. Ratio changes are an exception: every current reviewer immediately receives the old/new ratio and who changed it. Saving the same ratio again does not send another alert. Existing fixed monthly rules and already-awarded XP are unchanged.
- Each positive XP grant also queues a private donor thank-you DM: XP was credited as a token of gratitude for their donation, with a link to their Sentry history. This applies to manual/bulk approvals and monthly automatic grants. Failed DMs retry independently of the award; the grant remains visible in donor history.
- Adjustable INR ratio, initially ₹100 → 35 XP, rounded down. USD remains USD on screen, with its INR estimate, saved FX rate and timestamp. This is the rate when first resolved, **not a historical settlement rate or actual provider net proceeds**. Missing FX stays pending.
- Individual edits and bulk preview/approval, 15-minute reviewer claims, optimistic version checks, donor history and monthly-rule context.
- Monthly automation is explicit approval of future payments with the same Telegram ID, original currency and amount. Rules have expiry, pause/resume and a monthly cap. Only one payment per donor/IST month automatically qualifies; changed amounts and extra same-month payments require review. Historical records never auto-qualify.
- Unmatched payments remain held. Identity is taken from Sentinel's verified Telegram relationship, never guessed from names/email. A reviewer can explicitly match an existing Sentry user with recorded verification evidence. Owners with virtual infinite XP and globally banned users cannot receive grants.
- Refunds/voids before approval cancel the pending grant; after approval they create a reversal review. Reviewers may deduct a chosen amount, explicitly allow a negative balance, or waive it. Original approval details remain intact; requested/actual deductions are separately recorded. Ordinary positive rewards repay negative balances incrementally.
- Audit messages go to **-1003708272639, topic 99**, plus the Sentry admin history. Community grant messages use ordinary XP wording with no donation reason. Reversals have **no community announcement**. Reviewer DMs/audit logs still report reversals.
- Donors see only their own approved grant/reversal history, not reviewer discussions or other donors.

### Donate button and exports

The Sentry home button is **Donate (Get Perks!)**, above the menu. Its page explains gratitude XP, Stremio/Jellyfin, custom roles subject to rules, and other available perks. Access perks are for monthly supporters; a substantial one-time contribution may qualify for one month at admins' discretion, not automatically.

The donor chooses one-time or monthly before continuing. Monthly opens Sentinel's normal `start=monthly` path and existing role-approval workflow. One-time creates/reuses a 24-hour guest invitation, reserved for the authenticated Telegram ID. Only that account's `/start` in Sentinel reveals checkout. BMC guest checkout now creates an attribution reference as well; the donor must include the displayed reference as instructed in checkout.

Sentinel transaction CSV exports now start with **Telegram User ID** and include canonical donation/payment/transaction IDs, exact UTC time, original currency/amount, frequency, test/verification status and lifecycle. Sentry's **Import Sentinel transaction export** accepts CSV files or pasted CSV/tab-separated spreadsheet rows with headers.

Import previews counts for ready, duplicate, unmatched, FX-pending, ineligible, mismatched and not-yet-synced rows. It verifies financial fields against the durable Sentinel feed, reuses existing rows, and never treats a pasted file as proof of payment. Confirming an import marks verified selected records as historical review items; **it does not award XP**. Approval remains a separate preview/approve action. Files lacking the new ID columns must be exported again; preserve numeric Telegram IDs without spreadsheet rounding.

## Historical cutoff and optional provider recovery

The inclusive cutoff is **13 August 2026, 00:00 IST**, or **2026-08-12T18:30:00Z**. Test-mode, outgoing and unapproved payments are excluded.

`bridge:sync` performs a read-only paginated Razorpay payment sweep using live credentials and imports normalized payment facts into Sentinel's bridge tables. Existing finance rows win for reviewed attribution. BMC legacy one-time history is attempted, but its API is no longer actively maintained and does not guarantee full membership-charge history. The health panel explicitly reports that coverage gap; it must not be represented as a completed backfill.

Reconcile missing BMC charges using actual provider exports/failed delivery records and Sentinel's existing reconciliation tools. Subscription/member totals are **not** individual charge records. The CLI also accepts a reviewed normalized JSON array:

```sh
npx tsx scripts/donor-bridge.ts --import /secure/path/reviewed-payments.json
```

Each record needs `id`, `provider`, `paymentId`, `telegramId` (or null), `name`, decimal-string `amount`, `currency` (INR/USD), timezone-qualified `occurredAt`, `frequency` (ONE_TIME/MONTHLY), and `state` (PAID/REVERSED). Use the exact canonical IDs from the live feed/export; BMC monthly IDs retain their billing-period component. Never invent identities or payment IDs. This CLI modifies bridge records, not the existing finance ledger. The Sentry paste workflow is for the updated **Sentinel transaction export**, not an arbitrary BMC spreadsheet.

## Safe production setup — not executed by this change

1. Take and verify a PostgreSQL backup using the hosting provider's backup facility or `pg_dump`. Take a consistent SQLite backup of Sentry's existing persistent volume. Preserve the old images/commit IDs. Do not run seed scripts, database resets, or a broad `prisma db push` for this feature.
2. Generate one random server-only `SENTRY_BRIDGE_SECRET` (at least 32 characters, preferably 32 random bytes encoded as hex) and configure the identical value in both deployments. Do not put it in a `NEXT_PUBLIC_*` variable, browser, chat or Git. Keep the existing `CREDENTIAL_ENC_KEY`; do **not** rotate it as part of this rollout.
3. Sentinel requires its existing database, `BOT_USERNAME`, HTTPS `WEBAPP_URL`, encryption key and valid live provider settings. The history worker reads `.env`/process environment; ensure its live key pair matches the deployed web process. A Razorpay 401 remains a credentials/configuration error, not a bridge error.
4. From the production Sentinel checkout, apply **only** the additive bridge schema before starting the new code:

   ```sh
   npm run bridge:setup
   npm run build
   ```

   Restart the existing Sentinel web process and its bot process using the deployment's current supervisor. Only if direct provider recovery is wanted, run a supervised, automatically restarting worker from the same checkout/environment:

   ```sh
   npm run bridge:watch
   ```

   For PM2 deployments, the equivalent is `pm2 start npm --name sentinel-donor-bridge -- run bridge:watch`, followed by the deployment's usual `pm2 save`/startup setup. Do not create duplicate workers. The worker begins with a historical sweep; `npm run bridge:sync` is the one-shot alternative.
5. Configure Sentry's HTTPS `SENTINEL_URL` and the shared secret. Its webapp process must run continuously; that process hosts sync and notification workers. Keep the existing SQLite volume. On its first startup the donor module creates an online SQLite backup named `*.before-donor-xp-*` before creating its additive `dx_*` tables; startup fails if that backup cannot be made. Keep an off-host backup too.
6. The Sentry Dockerfile includes the new module. Using the existing Compose/Podman setup, rebuild the `bot` image, then recreate **both bot and webapp** services using that image while retaining `botdata` (the bot also has the negative-XP repayment fix). Do not remove volumes. If using Docker Compose, the usual commands are `docker compose build bot` and `docker compose up -d bot webapp`; use the actual production container tool/project configuration.
7. Verify existing `OT_TARGET_GROUP_ID` and the saved off-topic topic ID in Sentry. Those control the normal community announcement; they are different from audit destination `-1003708272639/99`. Check permission to post there and to topic 99. Each reviewer must have started Sentry privately to receive DMs. Telegram bot-to-bot mode is unnecessary for this API bridge.
8. Check Sentry → Admin → Donor XP → Bridge health: successful sync, review counts and notification failures. Export the desired Sentinel transactions, import them in Sentry, and check preview counts/duplicates/unmatched identities before approving. Optional provider recovery status is not a prerequisite for this workflow. An export contains only records actually present in Sentinel; recovering any missing finance records is a separate task.

### Controlled production acceptance check

Use the secondary account and normal production donation flow, with no allowlist. Verify original amount/currency, INR estimate, Telegram ID and one-time/monthly flag. Ensure the first payment is pending and balance unchanged. Preview/edit/approve once, confirm one XP ledger entry, reviewer DM, normal community message and topic-99 audit. Re-export/paste the same payment and verify duplicate handling. Void it in Sentinel, confirm reversal review, then test the explicit deduction/waiver choice and confirm no community reversal message.

Restart Sentry during ingestion/notification delivery and Sentinel briefly during syncing, then verify catch-up. Monthly next-month/date-boundary, concurrency and negative-balance branches are covered with isolated fixtures, not by altering production timestamps. Live payment capture, provider delivery permissions and the complete historical reconciliation still require this deployment acceptance check.

### Recovery and rollback

- A down Sentinel produces visible sync errors and blocks manual approval/import. Sentry replays retained events once it returns. A down Sentry retains local XP/outbox state and catches up after restart. A webhook missed during Sentinel downtime depends on provider retries/reconciliation; missing BMC legacy coverage requires provider-export recovery.
- XP mutations are transactionally idempotent. Telegram notifications are **at least once**, not mathematically exactly once: a crash after Telegram accepts a message but before storing its message ID can repeat a notification. It cannot repeat the XP award.
- If a rollout must be reverted, stop the new worker, deploy the previous application versions, and **retain both bridge ledgers and all `dx_*` tables**. Do not reset a cursor/drop a ledger after credits have been applied. Restoring an older DB can undo unrelated production changes; never do that casually.
- Existing payment/role workflows are not migrated or replaced. Missing bridge schema/secret causes the new bridge to fail closed. Revoke the temporary bot token previously shared in chat if it has not already been revoked.

## Verification

Run `npm test` and `npm run build` in Sentinel. In Sentry's installed Python environment run `python -m unittest discover -s donor_xp -t . -q`. Tests use temporary SQLite, fake HTTP transports and fake Telegram delivery; never production credentials. Browser QA uses a separate local fixture, not the deployed bot.
