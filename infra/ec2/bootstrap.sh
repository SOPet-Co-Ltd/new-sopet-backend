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
    dnf install -y docker jq awscli git amazon-ssm-agent
    systemctl enable --now docker
    systemctl enable --now amazon-ssm-agent
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y docker.io jq awscli git
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
install -m 755 "$(dirname "$0")/setup-caddy.sh" "$SOPET_DIR/setup-caddy.sh"

echo "Caddy is configured automatically on each deploy (see infra/ec2/Caddyfile.template)."

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
