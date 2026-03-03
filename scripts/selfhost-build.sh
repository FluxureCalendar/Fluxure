#!/usr/bin/env bash
set -euo pipefail

# Build Fluxure web assets for self-hosted deployment.
# Run from the repository root: ./scripts/selfhost-build.sh
#
# Prerequisites: Node.js 22+, pnpm 9.x
# Output: packages/web/build/ (static files ready for nginx)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building shared package..."
cd "$REPO_ROOT/packages/shared"
pnpm build

echo "==> Building web package..."
cd "$REPO_ROOT/packages/web"
pnpm build

BUILD_DIR="$REPO_ROOT/packages/web/build"
if [ ! -d "$BUILD_DIR" ]; then
    echo "ERROR: Build output not found at $BUILD_DIR"
    exit 1
fi

FILE_COUNT=$(find "$BUILD_DIR" -type f | wc -l)
echo "==> Build complete: $FILE_COUNT files in packages/web/build/"
echo "==> Ready for: docker compose -f docker-compose.selfhost.yml up -d"
