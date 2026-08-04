#!/usr/bin/env bash
# Optional escape hatch: build and push the Docker image on EC2.
# Default path builds natively on GitHub Actions (ubuntu-24.04-arm for linux/arm64).
# Enable with GitHub Environment variable BUILD_ON_HOST=true.
set -euo pipefail

: "${IMAGE_URI:?IMAGE_URI is required}"
: "${GIT_COMMIT:?GIT_COMMIT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

REPO_DIR="${REPO_DIR:-/opt/sopet/src}"
CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
# Fail early if root disk cannot hold a multi-stage Node build (GB).
MIN_FREE_GB="${MIN_FREE_GB:-3}"
# Soft wall for docker build; leave headroom under SSM executionTimeout (default 3600).
DOCKER_BUILD_TIMEOUT_SECONDS="${DOCKER_BUILD_TIMEOUT_SECONDS:-2700}"

log() {
  echo "[build-on-host $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

free_gb() {
  df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}'
}

require_disk() {
  local free
  free=$(free_gb)
  log "Disk free: ${free}G (minimum ${MIN_FREE_GB}G)"
  if [ "${free:-0}" -lt "$MIN_FREE_GB" ]; then
    log "ERROR: insufficient disk space on / (need >= ${MIN_FREE_GB}G free)" >&2
    df -h / >&2 || true
    docker system df >&2 || true
    exit 1
  fi
}

mkdir -p "$(dirname "$REPO_DIR")"

if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning ${GITHUB_REPOSITORY} into ${REPO_DIR}..."
  git clone "$CLONE_URL" "$REPO_DIR"
else
  log "Using existing clone at ${REPO_DIR}"
fi

cd "$REPO_DIR"
git remote set-url origin "$CLONE_URL"
log "Fetching commit ${GIT_COMMIT}..."
git fetch --depth 1 origin "$GIT_COMMIT"
git checkout "$GIT_COMMIT"
log "Checked out $(git rev-parse --short HEAD)"

ECR_REGISTRY="${IMAGE_URI%%/*}"
AWS_REGION_FROM_IMAGE=$(echo "$ECR_REGISTRY" | sed -n 's/.*\.ecr\.\([^.]*\)\.amazonaws\.com/\1/p')
AWS_REGION="${AWS_REGION_FROM_IMAGE:-${AWS_REGION:-ap-southeast-7}}"

# Small root disks (e.g. 8G) fill up with build cache + old tags; prune before
# build so yarn/docker don't hit ENOSPC mid-layer.
log "Disk before prune: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
log "Disk after prune: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"
require_disk

log "Building ${IMAGE_URI} on $(uname -m) (timeout ${DOCKER_BUILD_TIMEOUT_SECONDS}s)..."
export DOCKER_BUILDKIT=1
# --progress=plain: line-oriented logs (better for SSM/CloudWatch than tty spinner).
BUILD_CMD=(docker build --progress=plain -t "$IMAGE_URI" .)
if command -v timeout >/dev/null 2>&1; then
  timeout --signal=TERM --kill-after=60 "${DOCKER_BUILD_TIMEOUT_SECONDS}" "${BUILD_CMD[@]}"
else
  log "WARNING: GNU timeout not found — docker build has no local wall clock"
  "${BUILD_CMD[@]}"
fi

# Fresh login immediately before push — ECR tokens expire after ~12h; stale
# docker credentials on the host otherwise fail with "authorization token has expired".
log "Logging in to ECR registry $ECR_REGISTRY (region $AWS_REGION)"
ECR_PASSWORD=$(aws ecr get-login-password --region "$AWS_REGION")
if [ -z "$ECR_PASSWORD" ]; then
  log "ERROR: aws ecr get-login-password returned empty — check EC2 instance IAM role (ecr:GetAuthorizationToken)" >&2
  exit 1
fi
printf '%s' "$ECR_PASSWORD" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

log "Pushing ${IMAGE_URI}..."
docker push "$IMAGE_URI"
log "Pushed ${IMAGE_URI}"

# Drop intermediate build cache after a successful push; keep the just-built tag
# for deploy.sh on this host.
docker builder prune -af >/dev/null 2>&1 || true
log "Disk after build: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"
