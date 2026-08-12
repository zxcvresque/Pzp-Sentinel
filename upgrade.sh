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
#   • Stops on the first error (set -e), so a failed step won't restart a broken
#     build.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# Always operate from this script's directory (the repo root).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$*"; }

step "Pulling latest main…"
git fetch origin
git checkout main
git pull --ff-only origin main

step "Installing dependencies…"
npm ci

step "Applying Prisma schema…"
npx prisma db push

step "Regenerating Prisma client…"
npx prisma generate

step "Building (clean .next)…"
rm -rf .next
npm run build

step "Restarting PM2 (sentinel-web + sentinel-bot)…"
pm2 restart sentinel-web sentinel-bot
pm2 save

step "Verifying agent install endpoint…"
# Should print a bash shebang, not HTML — confirms the new build + middleware are live.
curl -fsS https://sentinel.piratezparty.com/install.sh 2>/dev/null | sed -n '1p' || true

ok "Upgrade complete."
