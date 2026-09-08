BEGIN;
-- Additive bridge tables; do not alter the finance ledger.
CREATE TABLE IF NOT EXISTS donor_bridge_sources (
  id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS donor_bridge_events (
  seq bigserial PRIMARY KEY, donation_id text NOT NULL, digest text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donor_bridge_events_donation ON donor_bridge_events(donation_id,seq DESC);
CREATE TABLE IF NOT EXISTS donor_bridge_state (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS donor_bridge_entries (
  telegram_id text PRIMARY KEY, token_cipher text NOT NULL, invite_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS donor_bridge_bmc_intents (
  intent_id text PRIMARY KEY, invite_id text NOT NULL
);
COMMIT;
