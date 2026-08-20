#!/bin/bash
# Sentinel VPS Monitoring Agent
# Collects system metrics and POSTs them to the Sentinel API on a loop.
#
# Usage:
#   SENTINEL_URL=https://your-app.com SENTINEL_TOKEN=your-token ./vps-agent.sh
#
# Setup:
#   1. Register this server in the Sentinel admin panel to get a token
#   2. Copy this script to the server
#   3. Run: SENTINEL_URL=https://pzp.finance SENTINEL_TOKEN=xxx ./vps-agent.sh
#   4. Or install as a systemd service (see below)
#
# Systemd service (optional):
#   sudo cp vps-agent.sh /usr/local/bin/sentinel-agent
#   sudo chmod +x /usr/local/bin/sentinel-agent
#   Create /etc/systemd/system/sentinel-agent.service:
#     [Unit]
#     Description=Sentinel VPS Agent
#     After=network-online.target
#     [Service]
#     Environment=SENTINEL_URL=https://pzp.finance
#     Environment=SENTINEL_TOKEN=your-token-here
#     ExecStart=/usr/local/bin/sentinel-agent
#     Restart=always
#     RestartSec=10
#     [Install]
#     WantedBy=multi-user.target
#   sudo systemctl enable --now sentinel-agent

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SENTINEL_URL="${SENTINEL_URL:?Set SENTINEL_URL}"
SENTINEL_TOKEN="${SENTINEL_TOKEN:?Set SENTINEL_TOKEN}"
INTERVAL="${INTERVAL:-30}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# ---------------------------------------------------------------------------
# Metric collection
# ---------------------------------------------------------------------------

collect_metrics() {
  # CPU usage (%) — vmstat samples over 1 second; the last line is the average.
  cpu=$(vmstat 1 2 | tail -1 | awk '{print 100 - $15}')

  # RAM (GB)
  ram_used=$(free -b | awk '/Mem:/ {printf "%.2f", $3 / 1073741824}')
  ram_total=$(free -b | awk '/Mem:/ {printf "%.2f", $2 / 1073741824}')

  # Disk — root partition (GB)
  disk_used=$(df -B1 / | tail -1 | awk '{printf "%.2f", $3 / 1073741824}')
  disk_total=$(df -B1 / | tail -1 | awk '{printf "%.2f", $2 / 1073741824}')

  # Network I/O — cumulative bytes on the default interface (GB)
  iface=$(ip route | awk '/default/ {print $5; exit}')
  if [[ -n "$iface" ]]; then
    net_in=$(awk -v iface="$iface:" '$1 == iface {printf "%.2f", $2 / 1073741824}' /proc/net/dev)
    net_out=$(awk -v iface="$iface:" '$1 == iface {printf "%.2f", $10 / 1073741824}' /proc/net/dev)
  else
    net_in="0.00"
    net_out="0.00"
  fi

  # Uptime (seconds)
  uptime_secs=$(awk '{print int($1)}' /proc/uptime)

  # Load average (1, 5, 15 min)
  load_avg=$(awk '{print $1 ", " $2 ", " $3}' /proc/loadavg)

  # Deployment/process health. PM2 output is reduced to non-sensitive health
  # metadata; environment variables and command arguments are never uploaded.
  if command -v pm2 >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    processes=$(pm2 jlist 2>/dev/null | node -e '
      let raw=""; process.stdin.on("data", c => raw += c); process.stdin.on("end", () => {
        try { console.log(JSON.stringify(JSON.parse(raw).slice(0,50).map(p => ({name:p.name,status:p.pm2_env?.status||"unknown",restarts:p.pm2_env?.restart_time||0,cpu:p.monit?.cpu||0,memory:p.monit?.memory||0,uptime:p.pm2_env?.pm_uptime ? Math.max(0,Math.floor((Date.now()-p.pm2_env.pm_uptime)/1000)) : 0})))); }
        catch { console.log("[]"); }
      });')
  else
    processes="[]"
  fi
  release_version="${SENTINEL_RELEASE_VERSION:-}"
}

# ---------------------------------------------------------------------------
# Send metrics to Sentinel
# ---------------------------------------------------------------------------

send_metrics() {
  local payload
  payload=$(cat <<EOF
{
  "cpu": $cpu,
  "ram_used": $ram_used,
  "ram_total": $ram_total,
  "disk_used": $disk_used,
  "disk_total": $disk_total,
  "net_in": $net_in,
  "net_out": $net_out,
  "uptime": $uptime_secs,
  "load_avg": "$load_avg",
  "ip": "$public_ip",
  "processes": $processes,
  "release_version": "$release_version"
}
EOF
)

  # POST to the heartbeat endpoint. Failures are logged but never fatal.
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$SENTINEL_URL/api/vps/heartbeat" \
    -H "Authorization: Bearer $SENTINEL_TOKEN" \
    -H "Content-Type: application/json" \
    --max-time 10 \
    -d "$payload" 2>/dev/null) || true

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    log "Heartbeat sent (HTTP $http_code)"
  else
    log "WARNING: heartbeat failed (HTTP $http_code)"
  fi
}

# ---------------------------------------------------------------------------
# Orchestrator — collect then send
# ---------------------------------------------------------------------------

collect_and_send() {
  if collect_metrics; then
    send_metrics
  else
    log "WARNING: metric collection failed, skipping this cycle"
  fi
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

log "Sentinel agent started (interval: ${INTERVAL}s)"
log "Reporting to: $SENTINEL_URL"

# Cache public IP once at startup — no need to re-fetch every loop.
public_ip=$(curl -4 -s --max-time 5 ifconfig.me || curl -4 -s --max-time 5 icanhazip.com || curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 icanhazip.com || echo "unknown")
log "Public IP: $public_ip"

while true; do
  collect_and_send
  sleep "$INTERVAL"
done
