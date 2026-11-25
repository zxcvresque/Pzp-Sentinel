-- Additive rollout only. Existing recurring rows deliberately remain
-- unconfirmed until matched to an actual paid charge / reviewed provider history.
BEGIN;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "bmcPaymentConfirmed" boolean NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" text;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "telegramMessageId" integer;
ALTER TABLE "BmcSubscriptionFeedback"
  ADD COLUMN IF NOT EXISTS "additionalInfo" text,
  ADD COLUMN IF NOT EXISTS "additionalInfoAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "responseSource" text,
  ADD COLUMN IF NOT EXISTS "telegramChatId" text,
  ADD COLUMN IF NOT EXISTS "telegramMessageId" integer,
  ADD COLUMN IF NOT EXISTS "responseRevision" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "telegramSyncedRevision" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "telegramSyncError" text,
  ADD COLUMN IF NOT EXISTS "telegramSyncClaimedAt" timestamp(3);
COMMIT;
