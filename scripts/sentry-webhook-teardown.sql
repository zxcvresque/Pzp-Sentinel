-- The outbound Sentry webhook was removed: Sentry polls GET /api/sentry-bridge/donations.
-- Drop the queueing trigger functions first (CASCADE removes every trigger that
-- uses them, on whichever tables exist), so no ledger write can reference the
-- queue, then drop the never-delivered queue itself. Safe to run repeatedly.
BEGIN;
DROP FUNCTION IF EXISTS sentinel_queue_donation_webhook() CASCADE;
DROP FUNCTION IF EXISTS sentinel_queue_donor_identity_webhook() CASCADE;
DROP FUNCTION IF EXISTS sentinel_queue_order_webhook() CASCADE;
DROP FUNCTION IF EXISTS sentinel_queue_bmc_publication_webhook() CASCADE;
DROP TABLE IF EXISTS "SentryWebhookDelivery";
COMMIT;
