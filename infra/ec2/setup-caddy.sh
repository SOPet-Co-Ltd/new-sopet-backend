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
  if [ -f /etc/systemd/system/caddy.service ]; then
    return 0
  fi

  cat >/etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy reverse proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=root
Group=root
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
}

if [ ! -f "$CADDYFILE_SRC" ]; then
  echo "Caddyfile not found: $CADDYFILE_SRC" >&2
  exit 1
fi

install_caddy_binary
install_caddy_systemd

mkdir -p /etc/caddy
install -m 644 "$CADDYFILE_SRC" /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile

if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl enable --now caddy
fi

systemctl is-active caddy
echo "Caddy configured from $CADDYFILE_SRC"
