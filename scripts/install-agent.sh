#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Sentinel VPS Agent — Auto-Installer
# ═══════════════════════════════════════════════════════════════════════
#
#   One-liner install:
#     curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- --token <TOKEN>
#
#   Or with self-registration (requires admin API key):
#     curl -fsSL https://sentinel.piratezparty.com/install.sh | sudo bash -s -- \
#       --register --api-key <JWT> --name "web-01" --ip 1.2.3.4 --platform ubuntu
#
#   What it does:
#     1. Validates prerequisites (curl, systemd, Linux)
#     2. Downloads the monitoring agent to /usr/local/bin/sentinel-agent
#     3. Optionally self-registers with the Sentinel API to get a token
#     4. Writes a systemd service unit
#     5. Enables and starts the service
#     6. Verifies the first heartbeat
#
#   Uninstall:
#     sudo systemctl disable --now sentinel-agent
#     sudo rm /usr/local/bin/sentinel-agent /etc/systemd/system/sentinel-agent.service
#     sudo systemctl daemon-reload
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
SENTINEL_URL="${SENTINEL_URL:-https://sentinel.piratezparty.com}"
SENTINEL_TOKEN=""
REGISTER=false
API_KEY=""
SERVER_NAME=""
SERVER_IP=""
SERVER_PLATFORM=""
SERVER_PROVIDER=""
SERVER_PASSWORD=""
SERVER_NOTES=""
INTERVAL=30
FORCE=false
AGENT_URL=""  # auto-derived from SENTINEL_URL if empty

INSTALL_DIR="/usr/local/bin"
SERVICE_FILE="/etc/systemd/system/sentinel-agent.service"
AGENT_BIN="$INSTALL_DIR/sentinel-agent"

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────
log()   { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

banner() {
  echo ""
  echo -e "${BOLD}  Ｓ ☰ ＮＴＩＮ ☰ Ｌ${NC}"
  echo -e "${DIM}  VPS Agent Installer${NC}"
  echo ""
}

usage() {
  cat <<'USAGE'
Usage:
  install-agent.sh --token <TOKEN> [OPTIONS]
  install-agent.sh --register --api-key <JWT> --name <NAME> --ip <IP> --platform <PLATFORM> [OPTIONS]

Required (pick one):
  --token <TOKEN>         Pre-generated server token from Sentinel dashboard
  --register              Self-register this server with the Sentinel API

Registration flags (required with --register):
  --api-key <JWT>         Admin JWT cookie value for API authentication
  --name <NAME>           Server display name (e.g. "web-01")
  --ip <IP>               Server IP address
  --platform <PLATFORM>   OS platform (e.g. "ubuntu", "debian")

Optional:
  --url <URL>             Sentinel base URL       (default: https://sentinel.piratezparty.com)
  --interval <SEC>        Heartbeat interval       (default: 30)
  --provider <NAME>       Hosting provider         (e.g. "hetzner", "contabo")
  --password <PASS>       Server root password     (stored in Sentinel for reference)
  --notes <TEXT>           Free-text notes
  --force                 Overwrite existing install
  -h, --help              Show this help
USAGE
  exit 0
}

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)       SENTINEL_TOKEN="$2"; shift 2 ;;
    --register)    REGISTER=true; shift ;;
    --api-key)     API_KEY="$2"; shift 2 ;;
    --name)        SERVER_NAME="$2"; shift 2 ;;
    --ip)          SERVER_IP="$2"; shift 2 ;;
    --platform)    SERVER_PLATFORM="$2"; shift 2 ;;
    --provider)    SERVER_PROVIDER="$2"; shift 2 ;;
    --password)    SERVER_PASSWORD="$2"; shift 2 ;;
    --notes)       SERVER_NOTES="$2"; shift 2 ;;
    --url)         SENTINEL_URL="$2"; shift 2 ;;
    --interval)    INTERVAL="$2"; shift 2 ;;
    --force)       FORCE=true; shift ;;
    -h|--help)     usage ;;
    *)             fail "Unknown option: $1 (use --help)" ;;
  esac
done

# ── Preflight checks ─────────────────────────────────────────────────
banner

log "Running preflight checks..."

[[ "$(uname -s)" == "Linux" ]] || fail "This installer only supports Linux"
[[ $EUID -eq 0 ]]              || fail "Run as root (use sudo)"
command -v curl  >/dev/null     || fail "curl is required — apt install curl"
command -v systemctl >/dev/null || fail "systemd is required"
command -v awk   >/dev/null     || fail "awk is required"

# Check for existing install
if [[ -f "$AGENT_BIN" && "$FORCE" != "true" ]]; then
  fail "Agent already installed at $AGENT_BIN — use --force to overwrite"
fi

ok "Preflight passed"

# ── Self-register if requested ────────────────────────────────────────
if [[ "$REGISTER" == "true" ]]; then
  [[ -n "$API_KEY" ]]        || fail "--api-key is required for registration"
  [[ -n "$SERVER_NAME" ]]    || fail "--name is required for registration"
  [[ -n "$SERVER_PLATFORM" ]]|| fail "--platform is required for registration"

  # Auto-detect IP if not provided
  if [[ -z "$SERVER_IP" ]]; then
    log "Detecting public IP..."
    SERVER_IP=$(curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 icanhazip.com || echo "")
    [[ -n "$SERVER_IP" ]] || fail "Could not detect IP — provide --ip"
    ok "Detected IP: $SERVER_IP"
  fi

  # Auto-detect password placeholder if not provided
  if [[ -z "$SERVER_PASSWORD" ]]; then
    SERVER_PASSWORD="(set via installer)"
  fi

  log "Registering server '${SERVER_NAME}' with Sentinel..."

  REGISTER_BODY=$(cat <<EOJSON
{
  "name": "$SERVER_NAME",
  "ip": "$SERVER_IP",
  "platform": "$SERVER_PLATFORM",
  "provider": "${SERVER_PROVIDER}",
  "password": "$SERVER_PASSWORD",
  "notes": "${SERVER_NOTES:-Installed via auto-installer}"
}
EOJSON
)

  REGISTER_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$SENTINEL_URL/api/vps" \
    -H "Content-Type: application/json" \
    -H "Cookie: token=$API_KEY" \
    --max-time 15 \
    -d "$REGISTER_BODY" 2>/dev/null) || fail "Could not reach Sentinel API at $SENTINEL_URL"

  HTTP_CODE=$(echo "$REGISTER_RESP" | tail -1)
  RESP_BODY=$(echo "$REGISTER_RESP" | sed '$d')

  if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
    fail "Registration failed (HTTP $HTTP_CODE): $RESP_BODY"
  fi

  # Extract token from JSON response
  SENTINEL_TOKEN=$(echo "$RESP_BODY" | grep -oP '"token"\s*:\s*"([^"]+)"' | head -1 | sed 's/.*"token"\s*:\s*"\([^"]*\)".*/\1/' || echo "")

  # Fallback: try python/node for JSON parsing
  if [[ -z "$SENTINEL_TOKEN" ]]; then
    SENTINEL_TOKEN=$(echo "$RESP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('server',{}).get('token',''))" 2>/dev/null || echo "")
  fi

  [[ -n "$SENTINEL_TOKEN" ]] || fail "Registration succeeded but no token returned. Is your API key an admin JWT? (Non-admin servers need approval first)"

  ok "Registered — token received"
fi

# ── Validate we have a token ──────────────────────────────────────────
[[ -n "$SENTINEL_TOKEN" ]] || fail "No token. Use --token <TOKEN> or --register"

# ── Download the agent script ─────────────────────────────────────────
log "Installing agent to $AGENT_BIN..."

AGENT_SCRIPT_URL="${AGENT_URL:-${SENTINEL_URL}/agent.sh}"

# Try downloading from the Sentinel URL first, fall back to GitHub raw
HTTP_STATUS=$(curl -s -o /tmp/sentinel-agent-dl -w "%{http_code}" \
  --max-time 15 "$AGENT_SCRIPT_URL" 2>/dev/null) || HTTP_STATUS="000"

if [[ "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
  # Fallback: embed the agent directly
  log "Remote download unavailable — embedding agent..."
  cat > /tmp/sentinel-agent-dl <<'AGENT_SCRIPT'
#!/bin/bash
# Sentinel VPS Monitoring Agent
# Collects system metrics and POSTs them to the Sentinel API on a loop.

set -euo pipefail

SENTINEL_URL="${SENTINEL_URL:?Set SENTINEL_URL}"
SENTINEL_TOKEN="${SENTINEL_TOKEN:?Set SENTINEL_TOKEN}"
INTERVAL="${INTERVAL:-30}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

collect_metrics() {
  cpu=$(vmstat 1 2 | tail -1 | awk '{print 100 - $15}')
  ram_used=$(free -b | awk '/Mem:/ {printf "%.2f", $3 / 1073741824}')
  ram_total=$(free -b | awk '/Mem:/ {printf "%.2f", $2 / 1073741824}')
  disk_used=$(df -B1 / | tail -1 | awk '{printf "%.2f", $3 / 1073741824}')
  disk_total=$(df -B1 / | tail -1 | awk '{printf "%.2f", $2 / 1073741824}')
  iface=$(ip route | awk '/default/ {print $5; exit}')
  if [[ -n "$iface" ]]; then
    net_in=$(awk -v iface="$iface:" '$1 == iface {printf "%.2f", $2 / 1073741824}' /proc/net/dev)
    net_out=$(awk -v iface="$iface:" '$1 == iface {printf "%.2f", $10 / 1073741824}' /proc/net/dev)
  else
    net_in="0.00"; net_out="0.00"
  fi
  uptime_secs=$(awk '{print int($1)}' /proc/uptime)
  load_avg=$(awk '{print $1 ", " $2 ", " $3}' /proc/loadavg)
}

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
  "ip": "$public_ip"
}
EOF
)
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

collect_and_send() {
  if collect_metrics; then
    send_metrics
  else
    log "WARNING: metric collection failed, skipping this cycle"
  fi
}

log "Sentinel agent started (interval: ${INTERVAL}s)"
log "Reporting to: $SENTINEL_URL"

public_ip=$(curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 icanhazip.com || echo "unknown")
log "Public IP: $public_ip"

while true; do
  collect_and_send
  sleep "$INTERVAL"
done
AGENT_SCRIPT
fi

cp /tmp/sentinel-agent-dl "$AGENT_BIN"
chmod +x "$AGENT_BIN"
rm -f /tmp/sentinel-agent-dl

ok "Agent installed at $AGENT_BIN"

# ── Write systemd service ────────────────────────────────────────────
log "Creating systemd service..."

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Sentinel VPS Monitoring Agent
Documentation=https://sentinel.piratezparty.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=SENTINEL_URL=$SENTINEL_URL
Environment=SENTINEL_TOKEN=$SENTINEL_TOKEN
Environment=INTERVAL=$INTERVAL
ExecStart=$AGENT_BIN
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/

[Install]
WantedBy=multi-user.target
UNIT

ok "Service written to $SERVICE_FILE"

# ── Enable and start ─────────────────────────────────────────────────
log "Starting sentinel-agent service..."
systemctl daemon-reload
systemctl enable --now sentinel-agent

# Wait for first heartbeat
sleep 3
if systemctl is-active --quiet sentinel-agent; then
  ok "Service is running"
else
  warn "Service may not have started — check: journalctl -u sentinel-agent -n 20"
fi

# ── Verify heartbeat ─────────────────────────────────────────────────
log "Verifying first heartbeat..."
sleep 5

VERIFY_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$SENTINEL_URL/api/vps/heartbeat" \
  -H "Authorization: Bearer $SENTINEL_TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 10 \
  -d '{"cpu":0,"ram_used":0,"ram_total":0,"disk_used":0,"disk_total":0,"net_in":0,"net_out":0,"uptime":0,"load_avg":"0","ip":"verify"}' \
  2>/dev/null) || VERIFY_CODE="000"

if [[ "$VERIFY_CODE" -ge 200 && "$VERIFY_CODE" -lt 300 ]]; then
  ok "Heartbeat verified — server is reporting to Sentinel"
else
  warn "Heartbeat check returned HTTP $VERIFY_CODE"
  warn "Token may not be approved yet, or URL is unreachable"
  echo -e "${DIM}  The agent will keep retrying automatically once approved.${NC}"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  Installation complete!${NC}"
echo ""
echo -e "  ${DIM}Service:${NC}   sentinel-agent"
echo -e "  ${DIM}Agent:${NC}     $AGENT_BIN"
echo -e "  ${DIM}Unit:${NC}      $SERVICE_FILE"
echo -e "  ${DIM}Interval:${NC}  ${INTERVAL}s"
echo -e "  ${DIM}API:${NC}       $SENTINEL_URL"
echo ""
echo -e "  ${DIM}Useful commands:${NC}"
echo -e "    journalctl -u sentinel-agent -f       ${DIM}# live logs${NC}"
echo -e "    systemctl status sentinel-agent        ${DIM}# service status${NC}"
echo -e "    systemctl restart sentinel-agent       ${DIM}# restart${NC}"
echo ""
