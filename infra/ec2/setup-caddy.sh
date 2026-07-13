#!/usr/bin/env bash
# Install/update Caddy on EC2 and apply /opt/sopet/Caddyfile (shipped by deploy).
set -euo pipefail

CADDYFILE_SRC="${CADDYFILE_SRC:-/opt/sopet/Caddyfile}"
CADDY_INSTALL_DIR="${CADDY_INSTALL_DIR:-/usr/bin}"
CADDY_VERSION="${CADDY_VERSION:-2.9.1}"

install_caddy_binary() {
  if command -v caddy >/dev/null 2>&1; then
    return 0
  fi

  local arch caddy_arch
  arch="$(uname -m)"
  case "$arch" in
    aarch64 | arm64) caddy_arch=arm64 ;;
    x86_64 | amd64) caddy_arch=amd64 ;;
    *)
      echo "Unsupported architecture for Caddy install: $arch" >&2
      exit 1
      ;;
  esac

  echo "Installing Caddy ${CADDY_VERSION} (${caddy_arch})..."
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  curl -fsSL \
    "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${caddy_arch}.tar.gz" \
    | tar -xz -C "$tmpdir" caddy
  install -m 755 "$tmpdir/caddy" "${CADDY_INSTALL_DIR}/caddy"
}

install_caddy_systemd() {
  cat >/etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy reverse proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
RestartSec=5
TimeoutStartSec=30
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
}

fix_tls_cert_permissions() {
  [ -f /certs/origin.pem ] || return 0
  [ -f /certs/origin-key.pem ] || return 0

  chmod 644 /certs/origin.pem
  chmod 640 /certs/origin-key.pem
  chown root:root /certs/origin.pem /certs/origin-key.pem

  # If a system caddy user exists (package install), allow group read on the key.
  if id caddy >/dev/null 2>&1; then
    chgrp caddy /certs/origin-key.pem
  fi
}

if [ ! -f "$CADDYFILE_SRC" ]; then
  echo "Caddyfile not found: $CADDYFILE_SRC" >&2
  exit 1
fi

echo "=== setup-caddy.sh: start ==="

install_caddy_binary
install_caddy_systemd
fix_tls_cert_permissions

mkdir -p /etc/caddy

# If TLS certs are missing, strip tls lines so Caddy can still serve HTTP on :443/:80.
if grep -qE '^\s*tls ' "$CADDYFILE_SRC" \
  && { [ ! -f /certs/origin.pem ] || [ ! -f /certs/origin-key.pem ]; }; then
  echo "WARN: /certs/origin.pem or origin-key.pem missing — using HTTP-only Caddyfile" >&2
  echo "      Install Cloudflare Origin CA certs or set CADDY_TLS_ENABLED=false in GitHub." >&2
  grep -vE '^\s*tls ' "$CADDYFILE_SRC" > /etc/caddy/Caddyfile
else
  install -m 644 "$CADDYFILE_SRC" /etc/caddy/Caddyfile
fi

if ! caddy validate --config /etc/caddy/Caddyfile 2>&1; then
  echo "ERROR: Caddyfile validation failed (see above)" >&2
  cat /etc/caddy/Caddyfile >&2
  exit 1
fi

# Restart (not reload) so systemd User=root applies and TLS certs are loaded cleanly.
systemctl enable caddy
systemctl restart caddy

if ! systemctl is-active --quiet caddy; then
  echo "ERROR: caddy service failed to start" >&2
  journalctl -u caddy -n 30 --no-pager >&2 || true
  exit 1
fi

echo "=== setup-caddy.sh: done ==="
