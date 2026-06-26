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
#   • No `prisma db push` here — schema changes are pushed from dev against the
#     shared DB; this only regenerates the client.
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
curl -fsSL https://sentinel.piratezparty.com/install.sh | head -1 || true

ok "Upgrade complete."
