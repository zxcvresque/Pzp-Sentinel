BEGIN;

-- Enqueue in the same database transaction as the ledger write. This covers
-- manual entries, provider webhooks, recovery, bulk changes and direct edits.
CREATE OR REPLACE FUNCTION sentinel_queue_donation_webhook() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  ident text;
  relevant boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  ident := COALESCE(after_row->>'id', before_row->>'id');
  SELECT EXISTS (
    SELECT 1 FROM (VALUES (before_row), (after_row)) AS records(value)
    WHERE value->>'type' = 'DONATION' AND value->>'direction' = 'IN'
      AND value->>'status' = 'APPROVED' AND value->>'isTest' = 'false'
      AND (value->>'amount')::numeric > 0
  ) INTO relevant;
  IF NOT relevant THEN RETURN NULL; END IF;
  -- Exclude receipt/announcement housekeeping, which changes no API facts.
  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['amount','currency','method','providerPaymentId',
      'bmcEventId','date','donationFrequency','voidedAt','voidReason','providerState',
      'fromUserId','type','direction','status','isTest']) AS fields(key)
    WHERE before_row->key IS DISTINCT FROM after_row->key
  ) THEN RETURN NULL; END IF;
  INSERT INTO "SentryWebhookDelivery" ("transactionId") VALUES (ident);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS sentinel_donation_webhook ON "Transaction";
CREATE TRIGGER sentinel_donation_webhook AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donation_webhook();

-- Identity corrections change the public donation even without a ledger edit.
CREATE OR REPLACE FUNCTION sentinel_queue_donor_identity_webhook() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    IF OLD."telegramId" IS NOT DISTINCT FROM NEW."telegramId" AND OLD.name IS NOT DISTINCT FROM NEW.name THEN RETURN NULL; END IF;
    INSERT INTO "SentryWebhookDelivery" ("transactionId")
    SELECT id FROM "Transaction" WHERE "fromUserId" = NEW.id AND type = 'DONATION'
      AND direction = 'IN' AND status = 'APPROVED' AND NOT "isTest" AND amount > 0;
  ELSIF TG_TABLE_NAME = 'OneTimeDonationInvite' THEN
    IF OLD."telegramId" IS NOT DISTINCT FROM NEW."telegramId" AND OLD."guestName" IS NOT DISTINCT FROM NEW."guestName" THEN RETURN NULL; END IF;
    INSERT INTO "SentryWebhookDelivery" ("transactionId")
    SELECT tx.id FROM "Transaction" tx JOIN "RazorpayOrder" ord ON ord."transactionId" = tx.id
    WHERE ord."inviteId" = NEW.id AND tx."fromUserId" IS NULL AND tx.type = 'DONATION'
      AND tx.direction = 'IN' AND tx.status = 'APPROVED' AND NOT tx."isTest" AND tx.amount > 0;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sentinel_donor_identity_webhook ON "User";
CREATE TRIGGER sentinel_donor_identity_webhook AFTER UPDATE OF "telegramId", name ON "User"
FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donor_identity_webhook();
DROP TRIGGER IF EXISTS sentinel_guest_identity_webhook ON "OneTimeDonationInvite";
CREATE TRIGGER sentinel_guest_identity_webhook AFTER UPDATE OF "telegramId", "guestName" ON "OneTimeDonationInvite"
FOR EACH ROW EXECUTE FUNCTION sentinel_queue_donor_identity_webhook();

-- Order linkage/payment references can be saved after the original payment.
CREATE OR REPLACE FUNCTION sentinel_queue_order_webhook() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_id text;
  new_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD."transactionId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW."transactionId"; END IF;
  IF TG_OP = 'UPDATE' AND OLD."transactionId" IS NOT DISTINCT FROM NEW."transactionId"
    AND OLD."paymentId" IS NOT DISTINCT FROM NEW."paymentId" AND OLD."inviteId" IS NOT DISTINCT FROM NEW."inviteId"
    THEN RETURN NULL; END IF;
  INSERT INTO "SentryWebhookDelivery" ("transactionId")
  SELECT id FROM "Transaction" WHERE id IN (new_id, old_id)
    AND type = 'DONATION' AND direction = 'IN' AND status = 'APPROVED' AND NOT "isTest" AND amount > 0;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sentinel_order_webhook ON "RazorpayOrder";
CREATE TRIGGER sentinel_order_webhook AFTER INSERT OR UPDATE OR DELETE ON "RazorpayOrder"
FOR EACH ROW
EXECUTE FUNCTION sentinel_queue_order_webhook();
COMMIT;
