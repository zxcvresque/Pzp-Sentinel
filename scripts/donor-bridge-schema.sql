BEGIN;
-- Additive table; do not alter the finance ledger. Links a guest BMC payment
-- intent to its one-time donation invite (guest BMC attribution).
-- Older bridge tables (donor_bridge_sources/events/state/entries) are no longer
-- created or used; existing copies are left untouched.
CREATE TABLE IF NOT EXISTS donor_bridge_bmc_intents (
  intent_id text PRIMARY KEY, invite_id text NOT NULL
);
COMMIT;
