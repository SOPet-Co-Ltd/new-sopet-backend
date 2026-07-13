#!/usr/bin/env bash
# One-time EC2 bootstrap for SOPET backend (Amazon Linux 2023 / Ubuntu 22.04+).
# Run as root on a fresh instance with an IAM instance profile that can pull from ECR.
set -euo pipefail

SOPET_DIR="/opt/sopet"
DEPLOY_USER="${DEPLOY_USER:-ec2-user}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash infra/ec2/bootstrap.sh" >&2
  exit 1
fi

install_packages() {
  if command -v dnf >/dev/null 2>&1; then
    dnf update -y
    dnf install -y docker jq awscli amazon-ssm-agent
    systemctl enable --now docker
    systemctl enable --now amazon-ssm-agent
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y docker.io jq awscli
    systemctl enable --now docker
    snap install amazon-ssm-agent --classic || apt-get install -y amazon-ssm-agent
    systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null || systemctl enable --now amazon-ssm-agent
  else
    echo "Unsupported OS. Install Docker, AWS CLI, jq, and SSM Agent manually." >&2
    exit 1
  fi
}

install_packages

usermod -aG docker "$DEPLOY_USER" 2>/dev/null || usermod -aG docker ubuntu 2>/dev/null || true

mkdir -p "$SOPET_DIR"
install -m 755 "$(dirname "$0")/deploy.sh" "$SOPET_DIR/deploy.sh"

if ! command -v caddy >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y yum-utils
    dnf copr enable -y @caddy/caddy epel-9-x86_64 || true
    dnf install -y caddy || true
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy || true
  fi
fi

if command -v caddy >/dev/null 2>&1; then
  install -d -m 755 /etc/caddy
  cat >/etc/caddy/Caddyfile <<'EOF'
# Replace api.example.com with your Cloudflare hostname before enabling TLS.
# Cloudflare orange-cloud proxy terminates TLS at the edge; use HTTP on origin.
:80 {
  reverse_proxy 127.0.0.1:3002
}
EOF
  systemctl enable --now caddy
fi

cat <<EOF

Bootstrap complete.

Next steps:
1. Attach an IAM instance profile with ECR pull permissions (see infra/iam/ec2-instance-ecr-policy.json).
2. Security group: allow TCP 80/443 from the internet (or Cloudflare IP ranges) and restrict SSH.
3. Ensure the instance appears as "Online" in AWS Systems Manager → Fleet Manager.
4. Point Cloudflare DNS A record to this instance public IP (proxied orange cloud is fine with :80 origin).
5. Configure GitHub Environment vars: EC2_INSTANCE_ID, ECR_REPOSITORY, AWS_REGION.
6. Push to deploy/uat or deploy/production to deploy via GitHub Actions.

EOF
