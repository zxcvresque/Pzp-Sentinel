-- Apply before deploying the member-access/account-cleanup changes.
-- Additive only: existing users, role assignments and payment records remain.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "autoRemovedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "donorAccessGrantedAt" TIMESTAMP(3);
