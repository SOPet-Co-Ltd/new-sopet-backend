#!/usr/bin/env bash
# Render infra/ec2/Caddyfile from GitHub Environment variables.
set -euo pipefail

OUTPUT="${1:-.caddy.deploy}"

: "${CADDY_HOSTNAME:?CADDY_HOSTNAME is required (e.g. api-new-uat.sopet.org)}"

CADDY_ADMIN_EMAIL="${CADDY_ADMIN_EMAIL:-admin@sopet.org}"
API_PORT="${PORT:-3002}"
CADDY_TLS_CERT="${CADDY_TLS_CERT:-/certs/origin.pem}"
CADDY_TLS_KEY="${CADDY_TLS_KEY:-/certs/origin-key.pem}"
CADDY_TLS_ENABLED="${CADDY_TLS_ENABLED:-true}"

{
  printf '{\n\temail %s\n}\n\n' "$CADDY_ADMIN_EMAIL"
  printf '%s {\n' "$CADDY_HOSTNAME"
  if [ "$CADDY_TLS_ENABLED" = "true" ]; then
    printf '\ttls %s %s\n' "$CADDY_TLS_CERT" "$CADDY_TLS_KEY"
  fi
  cat <<EOF
	encode gzip zstd

	reverse_proxy 127.0.0.1:${API_PORT}
}
EOF
} >"$OUTPUT"

echo "Wrote $OUTPUT for host ${CADDY_HOSTNAME} → 127.0.0.1:${API_PORT}"
