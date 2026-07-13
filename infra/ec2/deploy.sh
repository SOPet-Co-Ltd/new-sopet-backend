#!/usr/bin/env bash
# Runs on EC2 (installed to /opt/sopet/deploy.sh by bootstrap.sh).
set -euo pipefail

IMAGE_URI="${IMAGE_URI:?IMAGE_URI is required}"
ENV_FILE="${ENV_FILE:-/opt/sopet/.env}"
CONTAINER_NAME="${CONTAINER_NAME:-sopet-api}"
PORT="${PORT:-3002}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

PORT="$(grep -E '^PORT=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
PORT="${PORT:-3002}"

ECR_REGISTRY="${IMAGE_URI%%/*}"
# ECR auth tokens are region-specific — always match the registry host.
AWS_REGION_FROM_IMAGE=$(echo "$ECR_REGISTRY" | sed -n 's/.*\.ecr\.\([^.]*\)\.amazonaws\.com/\1/p')
if [ -n "$AWS_REGION_FROM_IMAGE" ]; then
  AWS_REGION="$AWS_REGION_FROM_IMAGE"
elif [ -z "${AWS_REGION:-}" ]; then
  TOKEN=$(curl -fsS --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    AWS_REGION=$(curl -fsS --max-time 2 \
      -H "X-aws-ec2-metadata-token: $TOKEN" \
      "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null || true)
  else
    AWS_REGION=$(curl -fsS --max-time 2 \
      "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null || true)
  fi
fi
AWS_REGION="${AWS_REGION:-ap-southeast-7}"

echo "Logging in to ECR registry $ECR_REGISTRY (region $AWS_REGION)"
ECR_PASSWORD=$(aws ecr get-login-password --region "$AWS_REGION")
if [ -z "$ECR_PASSWORD" ]; then
  echo "aws ecr get-login-password returned empty — check EC2 instance IAM role (ecr:GetAuthorizationToken)" >&2
  exit 1
fi
printf '%s' "$ECR_PASSWORD" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Pulling $IMAGE_URI"
docker pull --quiet "$IMAGE_URI"

echo "Restarting container $CONTAINER_NAME"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -p "127.0.0.1:${PORT}:${PORT}" \
  "$IMAGE_URI"

docker image prune -f >/dev/null 2>&1 || true

if ! curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/graphql" -o /dev/null \
  -H 'content-type: application/json' \
  --data '{"query":"{ __typename }"}'; then
  echo "Warning: GraphQL health check failed immediately after start (container may still be warming up)." >&2
fi

docker ps --filter "name=$CONTAINER_NAME"
echo "Deploy finished: $IMAGE_URI"
