#!/usr/bin/env bash
# Build and push the Docker image on EC2 (native arm64 — avoids QEMU cross-build on GHA).
set -euo pipefail

: "${IMAGE_URI:?IMAGE_URI is required}"
: "${GIT_COMMIT:?GIT_COMMIT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

REPO_DIR="${REPO_DIR:-/opt/sopet/src}"
CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

mkdir -p "$(dirname "$REPO_DIR")"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning ${GITHUB_REPOSITORY} into ${REPO_DIR}..."
  git clone "$CLONE_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git remote set-url origin "$CLONE_URL"
git fetch --depth 1 origin "$GIT_COMMIT"
git checkout "$GIT_COMMIT"

ECR_REGISTRY="${IMAGE_URI%%/*}"
AWS_REGION_FROM_IMAGE=$(echo "$ECR_REGISTRY" | sed -n 's/.*\.ecr\.\([^.]*\)\.amazonaws\.com/\1/p')
AWS_REGION="${AWS_REGION_FROM_IMAGE:-${AWS_REGION:-ap-southeast-7}}"

# Small root disks (e.g. 8G) fill up with build cache + old tags; prune before
# build so yarn/docker don't hit ENOSPC mid-layer.
echo "Disk before prune: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
echo "Disk after prune: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"

echo "Building ${IMAGE_URI} on $(uname -m)..."
docker build -t "$IMAGE_URI" .

# Fresh login immediately before push — ECR tokens expire after ~12h; stale
# docker credentials on the host otherwise fail with "authorization token has expired".
echo "Logging in to ECR registry $ECR_REGISTRY (region $AWS_REGION)"
ECR_PASSWORD=$(aws ecr get-login-password --region "$AWS_REGION")
if [ -z "$ECR_PASSWORD" ]; then
  echo "aws ecr get-login-password returned empty — check EC2 instance IAM role (ecr:GetAuthorizationToken)" >&2
  exit 1
fi
printf '%s' "$ECR_PASSWORD" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker push "$IMAGE_URI"
echo "Pushed ${IMAGE_URI}"

# Drop intermediate build cache after a successful push; keep the just-built tag
# for deploy.sh on this host.
docker builder prune -af >/dev/null 2>&1 || true
echo "Disk after build: $(df -h / | awk 'NR==2{print $3" used / "$4" free ("$5")"}')"
