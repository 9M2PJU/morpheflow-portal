#!/bin/sh
# nFPM pre-remove: stop service (data in /var/lib/morpheflow is preserved).
set -eu
if [ -d /run/systemd/system ]; then
  if [ "${1:-}" = "remove" ] || [ "${1:-}" = "0" ]; then
    systemctl stop morpheflow 2>/dev/null || true
    systemctl disable morpheflow 2>/dev/null || true
  fi
fi
exit 0
