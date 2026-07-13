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

echo "Building ${IMAGE_URI} on $(uname -m)..."
docker build -t "$IMAGE_URI" .
docker push "$IMAGE_URI"
echo "Pushed ${IMAGE_URI}"
