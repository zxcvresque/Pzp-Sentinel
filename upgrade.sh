#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Sentinel — one-command deploy
# ───────────────────────────────────────────────────────────────────────
# Pulls latest main, installs deps, regenerates the Prisma client, rebuilds,
# and restarts both PM2 processes. Run on the Sentinel VPS from the app dir:
#
#     bash upgrade.sh        # or, after `chmod +x upgrade.sh`:  ./upgrade.sh
#
# Notes:
#   • Applies additive Prisma schema changes before building the new app.
#   • Gives the Next.js build a 3 GiB V8 heap by default. Override with
#     SENTINEL_BUILD_HEAP_MB or an existing --max-old-space-size NODE_OPTIONS.
#   • Stops on the first error (set -e), so a failed step won't restart a broken
#     build.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# Always operate from this script's directory (the repo root).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m⚠ %s\033[0m\n' "$*"; }

# Next.js 16 type-checking can exceed Node's default ~2 GiB old-space limit.
# Respect an operator-supplied NODE_OPTIONS value; otherwise add a configurable
# heap ceiling. This changes only the deployment shell and is not saved by PM2.
BUILD_HEAP_MB="${SENTINEL_BUILD_HEAP_MB:-3072}"
if ! [[ "$BUILD_HEAP_MB" =~ ^[1-9][0-9]*$ ]]; then
  printf '\033[0;31mInvalid SENTINEL_BUILD_HEAP_MB: %s (expected a positive integer)\033[0m\n' "$BUILD_HEAP_MB" >&2
  exit 1
fi
if [[ "${NODE_OPTIONS:-}" =~ --max-old-space-size=([0-9]+) ]]; then
  EFFECTIVE_HEAP_MB="${BASH_REMATCH[1]}"
else
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$BUILD_HEAP_MB"
  EFFECTIVE_HEAP_MB="$BUILD_HEAP_MB"
fi

# A larger heap still needs backing RAM or swap. Warn early on small VPSes and
# leave swap provisioning to the operator because it requires root and disk.
if [[ -r /proc/meminfo ]]; then
  BACKING_MB="$(awk '/^(MemTotal|SwapTotal):/ { total += $2 } END { printf "%d", total / 1024 }' /proc/meminfo)"
  if (( BACKING_MB < EFFECTIVE_HEAP_MB + 512 )); then
    warn "Only ${BACKING_MB} MiB RAM + swap detected; a ${EFFECTIVE_HEAP_MB} MiB build heap may still need additional swap."
  fi
fi

step "Pulling latest main…"
git fetch origin
git checkout main
git pull --ff-only origin main

step "Installing dependencies…"
npm ci

step "Normalizing legacy data before schema constraints…"
# Older builds allowed duplicate tag names within one project. Merge their
# implicit Task↔Tag links into the oldest tag before adding the composite
# unique constraint. Older renewal jobs could also reuse an idempotency key;
# retain every transaction but clear that key from all except the best active
# record before adding its unique constraint. This cleanup is idempotent.
npx prisma db execute --stdin <<'SQL'
DO $$
DECLARE
  duplicate RECORD;
BEGIN
  FOR duplicate IN
    SELECT ranked.id AS duplicate_id, ranked.keep_id
    FROM (
      SELECT
        id,
        FIRST_VALUE(id) OVER (PARTITION BY "projectId", name ORDER BY id) AS keep_id,
        ROW_NUMBER() OVER (PARTITION BY "projectId", name ORDER BY id) AS position
      FROM "Tag"
      WHERE "projectId" IS NOT NULL
    ) ranked
    WHERE ranked.position > 1
  LOOP
    INSERT INTO "_TaskTags" ("A", "B")
    SELECT duplicate.keep_id, links."B"
    FROM "_TaskTags" links
    WHERE links."A" = duplicate.duplicate_id
    ON CONFLICT DO NOTHING;

    DELETE FROM "_TaskTags" WHERE "A" = duplicate.duplicate_id;
    DELETE FROM "Tag" WHERE id = duplicate.duplicate_id;
  END LOOP;
END $$;

WITH ranked_renewals AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "automatedRenewalKey"
      ORDER BY
        CASE
          WHEN "voidedAt" IS NULL AND status IN ('PENDING', 'APPROVED') THEN 0
          ELSE 1
        END,
        "createdAt",
        id
    ) AS duplicate_position
  FROM "Transaction"
  WHERE "automatedRenewalKey" IS NOT NULL
)
UPDATE "Transaction" AS tx
SET "automatedRenewalKey" = NULL
FROM ranked_renewals
WHERE tx.id = ranked_renewals.id
  AND ranked_renewals.duplicate_position > 1;
SQL

step "Applying Prisma schema…"
npx prisma db push --accept-data-loss

step "Regenerating Prisma client…"
npx prisma generate

step "Building (clean .next, heap ${EFFECTIVE_HEAP_MB} MiB)…"
rm -rf .next
npm run build

step "Restarting PM2 (sentinel-web + sentinel-bot)…"
pm2 restart sentinel-web sentinel-bot
pm2 save

step "Verifying agent install endpoint…"
# Should print a bash shebang, not HTML — confirms the new build + middleware are live.
curl -fsS https://sentinel.piratezparty.com/install.sh 2>/dev/null | sed -n '1p' || true

ok "Upgrade complete."
