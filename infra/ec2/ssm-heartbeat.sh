#!/usr/bin/env bash
# Background heartbeat for long SSM Run Command sessions.
# Sourced or exec'd from the SSM command list; prints every HEARTBEAT_INTERVAL_SECONDS.
set -euo pipefail

HEARTBEAT_INTERVAL_SECONDS="${HEARTBEAT_INTERVAL_SECONDS:-60}"
HEARTBEAT_PID=""

ssm_heartbeat_start() {
  (
    while true; do
      load="n/a"
      disk="n/a"
      if [ -r /proc/loadavg ]; then
        load=$(cut -d' ' -f1-3 /proc/loadavg)
      fi
      disk=$(df -h / 2>/dev/null | awk 'NR==2{print $4 " free (" $5 " used)"}')
      echo "[heartbeat] $(date -u +%Y-%m-%dT%H:%M:%SZ) load=${load} disk=${disk}"
      sleep "$HEARTBEAT_INTERVAL_SECONDS"
    done
  ) &
  HEARTBEAT_PID=$!
  trap ssm_heartbeat_stop EXIT
}

ssm_heartbeat_stop() {
  if [ -n "${HEARTBEAT_PID:-}" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}
