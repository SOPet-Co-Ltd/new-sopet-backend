#!/usr/bin/env bash
# Validate required GitHub Environment variables/secrets before deploy.
set -euo pipefail

ENVIRONMENT_NAME="${1:?Environment name required (deploy/uat or deploy/production)}"

REQUIRED_VARS=(
  AWS_REGION
  ECR_REPOSITORY
  EC2_INSTANCE_ID
  CADDY_HOSTNAME
  NODE_ENV
  PORT
  DB_HOST
  DB_PORT
  DB_USERNAME
  DB_NAME
  DB_SSL
  STORAGE_PROVIDER
  CDN_URL
  JWT_ACCESS_EXPIRES_IN
  JWT_REFRESH_EXPIRES_IN
  API_URL
  STOREFRONT_URL
  ADMIN_PANEL_URL
  CORS_ORIGINS
  COMMISSION_GO_LIVE_AT
)

REQUIRED_SECRETS=(
  AWS_ROLE_ARN
  DB_PASSWORD
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_ACCESS_KEY_ID
  CLOUDFLARE_SECRET_ACCESS_KEY
  CLOUDFLARE_R2_BUCKET
  JWT_SECRET
  OTP_HMAC_SECRET
  BANK_DATA_ENCRYPTION_KEY
  THAIBULKSMS_API_KEY
  THAIBULKSMS_API_SECRET
  OMISE_PUBLIC_KEY
  OMISE_SECRET_KEY
  OMISE_WEBHOOK_SECRET
  RESEND_API_KEY
)

missing=()

for name in "${REQUIRED_VARS[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    missing+=("Variable: $name")
  fi
done

for name in "${REQUIRED_SECRETS[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    missing+=("Secret: $name")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::Missing GitHub Environment configuration for '$ENVIRONMENT_NAME':" >&2
  for item in "${missing[@]}"; do
    echo "::error::  - $item" >&2
  done
  echo "::error::Add them under Settings → Environments → $ENVIRONMENT_NAME" >&2
  echo "::error::If values are already set, check Environment → Deployment branches allows this ref." >&2
  echo "::error::Key list: infra/github-env.keys — production guide: docs/deploy-production.md" >&2
  exit 1
fi

# Optional but strongly recommended for Graviton (same structure as UAT).
PLATFORM="${DOCKER_PLATFORM:-}"
if [ -z "$PLATFORM" ]; then
  echo "::warning::DOCKER_PLATFORM is unset on '$ENVIRONMENT_NAME' (workflow defaults to linux/amd64)." >&2
  echo "::warning::For Graviton EC2 set Variable DOCKER_PLATFORM=linux/arm64 (runner → ubuntu-24.04-arm)." >&2
elif [ "$PLATFORM" != "linux/arm64" ] && [ "$PLATFORM" != "linux/amd64" ]; then
  echo "::error::DOCKER_PLATFORM='$PLATFORM' is unsupported (use linux/arm64 or linux/amd64)" >&2
  exit 1
else
  echo "DOCKER_PLATFORM=$PLATFORM"
fi

if [ "${BUILD_ON_HOST:-}" = "true" ]; then
  echo "::warning::BUILD_ON_HOST=true on '$ENVIRONMENT_NAME' — EC2 will build (slow). Prefer unset for pull-only." >&2
fi

echo "Deploy environment '$ENVIRONMENT_NAME' has all required variables and secrets."
