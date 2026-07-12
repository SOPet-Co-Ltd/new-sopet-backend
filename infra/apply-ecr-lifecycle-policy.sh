#!/usr/bin/env bash
# Apply ECR lifecycle policy (keep last 5 images; expire untagged after 7 days).
#
# One-time setup (recommended): run with an admin AWS profile that can manage ECR.
# The GitHub deploy role typically only has push/pull permissions, not PutLifecyclePolicy.
#
# Usage:
#   AWS_REGION=ap-southeast-7 ECR_REPOSITORY=sopet/sopet-backend ./infra/apply-ecr-lifecycle-policy.sh
#
# Optional — allow GitHub deploy roles to manage lifecycle policies, attach:
#   infra/iam/github-deploy-ecr-lifecycle-policy.json
# to sopet-github-deploy-uat / sopet-github-deploy-production.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:?Set ECR_REPOSITORY (e.g. sopet-backend)}"

aws ecr put-lifecycle-policy \
  --region "$AWS_REGION" \
  --repository-name "$ECR_REPOSITORY" \
  --lifecycle-policy-text "file://${SCRIPT_DIR}/ecr-lifecycle-policy.json"

echo "Lifecycle policy applied to ${ECR_REPOSITORY} in ${AWS_REGION}"
