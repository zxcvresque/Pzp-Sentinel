#!/usr/bin/env bash
# Optional cleanup for the removed server-hosted BMC login feature.
# Does not touch saved sessions, payment history, or general Playwright caches.
set -euo pipefail
profile=/etc/apparmor.d/sentinel-bmc-browser
browser_root=/opt/sentinel-bmc-browser
if [[ "${1:-}" != --apply ]]; then
  echo 'Preview: unload/remove /etc/apparmor.d/sentinel-bmc-browser and delete /opt/sentinel-bmc-browser only.'
  echo 'Apply: bash scripts/remove-bmc-browser-setup.sh --apply'
  exit 0
fi
if pgrep -f '^/opt/sentinel-bmc-browser/' >/dev/null; then
  echo 'A managed browser is running. Deploy/restart Sentinel to close the old login, then retry cleanup.' >&2
  exit 1
fi
if [[ -e "$profile" ]]; then
  sudo apparmor_parser -R "$profile"
  sudo rm -- "$profile"
fi
if [[ -d "$browser_root" ]]; then
  if [[ -L "$browser_root" ]] || [[ "$(stat -c '%u' "$browser_root")" != 0 ]]; then
    echo 'Refusing cleanup: expected a real root-owned managed browser directory.' >&2
    exit 1
  fi
  sudo rm -rf -- "$browser_root"
fi
echo 'Removed the old BMC browser setup. Saved BMC sessions and history are unchanged.'
