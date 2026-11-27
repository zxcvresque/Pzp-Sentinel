BEGIN;
-- All new donations get a key independent of donor names, dates, FX and provider metadata.
-- Existing keys are backfilled separately, preserving the IDs consumers already saw.
CREATE OR REPLACE FUNCTION sentinel_pin_donation_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."bridgeDonationId" IS NULL THEN
    NEW."bridgeDonationId" := CASE NEW.method::text
      WHEN 'BMC' THEN 'bmc:' WHEN 'RAZORPAY' THEN 'razorpay:' ELSE 'manual:' END || NEW.id;
  ELSIF TG_OP = 'UPDATE' AND OLD."bridgeDonationId" IS NOT NULL
    AND OLD."bridgeDonationId" IS DISTINCT FROM NEW."bridgeDonationId" THEN
    RAISE EXCEPTION 'Donation identity is immutable';
  END IF;
  -- Uniqueness must span both the original reference and the history claim.
  -- A separate web worker cannot insert the same charge between check and save.
  IF NEW.method::text = 'BMC' AND (NEW."providerPaymentId" IS NOT NULL OR NEW."bmcHistoryPaymentId" IS NOT NULL)
    AND (TG_OP = 'INSERT' OR OLD.method IS DISTINCT FROM NEW.method
      OR OLD."providerPaymentId" IS DISTINCT FROM NEW."providerPaymentId"
      OR OLD."bmcHistoryPaymentId" IS DISTINCT FROM NEW."bmcHistoryPaymentId") THEN
    PERFORM pg_advisory_xact_lock(hashtext('sentinel-bmc-history'));
    IF EXISTS (
      SELECT 1 FROM "Transaction" other WHERE other.id <> NEW.id AND other.method::text = 'BMC'
        AND (other."providerPaymentId" IN (NEW."providerPaymentId", NEW."bmcHistoryPaymentId")
          OR other."bmcHistoryPaymentId" IN (NEW."providerPaymentId", NEW."bmcHistoryPaymentId"))
    ) THEN
      RAISE EXCEPTION 'BMC charge already belongs to another transaction' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sentinel_pin_donation_identity ON "Transaction";
CREATE TRIGGER sentinel_pin_donation_identity BEFORE INSERT OR UPDATE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION sentinel_pin_donation_identity();
COMMIT;
