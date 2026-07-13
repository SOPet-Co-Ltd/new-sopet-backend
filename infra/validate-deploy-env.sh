#!/usr/bin/env bash
# Validate required GitHub Environment variables/secrets before deploy.
set -euo pipefail

ENVIRONMENT_NAME="${1:?Environment name required (uat or production)}"

REQUIRED_VARS=(
  AWS_REGION
  ECR_REPOSITORY
  EC2_INSTANCE_ID
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
  STOREFRONT_URL
  ADMIN_PANEL_URL
  CORS_ORIGINS
)

REQUIRED_SECRETS=(
  AWS_ROLE_ARN
  DB_PASSWORD
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_ACCESS_KEY_ID
  CLOUDFLARE_SECRET_ACCESS_KEY
  CLOUDFLARE_R2_BUCKET
  JWT_SECRET
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
  echo "::error::If values are already set, check Environment → Deployment branches allows branch: $GITHUB_REF_NAME" >&2
  exit 1
fi

echo "Deploy environment '$ENVIRONMENT_NAME' has all required variables and secrets."
