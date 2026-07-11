#!/usr/bin/env bash
# Apply ECR lifecycle policy (keep last 10 images; expire untagged after 7 days).
# Run once per ECR repository (e.g. production and uat if separate).
#
# Usage:
#   AWS_REGION=ap-southeast-1 ECR_REPOSITORY=sopet-backend ./infra/apply-ecr-lifecycle-policy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:?Set ECR_REPOSITORY (e.g. sopet-backend)}"

aws ecr put-lifecycle-policy \
  --region "$AWS_REGION" \
  --repository-name "$ECR_REPOSITORY" \
  --lifecycle-policy-text "file://${SCRIPT_DIR}/ecr-lifecycle-policy.json"

echo "Lifecycle policy applied to ${ECR_REPOSITORY} in ${AWS_REGION}"
