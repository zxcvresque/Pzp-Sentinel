#!/usr/bin/env bash
# Setup Sentinel cron jobs on the deployment server.
# Usage: CRON_SECRET=your_secret WEBAPP_URL=https://pzp.finance bash scripts/setup-crons.sh

set -euo pipefail

WEBAPP_URL="${WEBAPP_URL:-https://pzp.finance}"
CRON_SECRET="${CRON_SECRET:?CRON_SECRET env var is required}"

# Service expiry check — daily at 9:00 AM UTC
CRON_LINE="0 9 * * * curl -s -H 'Authorization: Bearer ${CRON_SECRET}' ${WEBAPP_URL}/api/cron/service-expiry > /dev/null 2>&1"

# Avoid duplicates
( crontab -l 2>/dev/null | grep -v 'cron/service-expiry' ; echo "$CRON_LINE" ) | crontab -

echo "Cron installed:"
echo "  $CRON_LINE"
echo ""
echo "Verify with: crontab -l"
