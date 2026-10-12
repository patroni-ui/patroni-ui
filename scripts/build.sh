#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-armantarkhanian/patroni-ui}"
VERSION="${VERSION:-0.1.0}"
DIST="${DIST:-dist}"

cd "$(dirname "$0")/.."

mkdir -p "$DIST"

# 1) Export the linux + windows amd64 binaries from the build stage.
docker buildx build \
  --target export \
  --output "type=local,dest=${DIST}" \
  .

# 2) Build and load the runnable Docker image.
docker buildx build \
  --platform linux/amd64 \
  --load \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  .

echo "Built:"
echo "  image:  ${IMAGE}:${VERSION} (and :latest)"
echo "  dist:"
ls -l "$DIST"
