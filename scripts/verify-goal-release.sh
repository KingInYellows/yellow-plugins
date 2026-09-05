#!/usr/bin/env bash
# Same public-artifact compatibility gate for same-repository and fork CI.
# No authentication, source imports, live providers, or real executors.
# The pinned version, asset URL, and SHA-256 below are kept in agreement
# with plugins/yellow-goal/src/pin.ts by tests/release-pin.test.ts.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${TMPDIR:?Set TMPDIR to the isolated runtime directory}"

PINNED_ENGINE_VERSION="0.2.0"
PINNED_ENGINE_ASSET_URL="https://github.com/KingInYellows/yellow-goal/releases/download/v0.2.0/goal-gen-0.2.0.tgz"
PINNED_ENGINE_ASSET_SHA256="7ad266b22603007552b582b83349464cc67f4976eca63bf4db56ffacc4e1663a"

consumer="$(mktemp -d "$TMPDIR/goal-release-consumer.XXXXXX")"
trap 'rm -rf -- "$consumer"' EXIT
asset="$consumer/goal-gen-${PINNED_ENGINE_VERSION}.tgz"
curl --fail --silent --show-error --location --retry 3 --output "$asset" \
  "$PINNED_ENGINE_ASSET_URL"

# Verify the public asset hash BEFORE anything from it is installed.
actual_sha="$(sha256sum "$asset" | awk '{print $1}')"
if [ "$actual_sha" != "$PINNED_ENGINE_ASSET_SHA256" ]; then
  echo "released goal-gen asset SHA-256 mismatch: expected $PINNED_ENGINE_ASSET_SHA256, got $actual_sha" >&2
  exit 1
fi

npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund "$asset"
GOAL_GEN_BIN="$consumer/node_modules/.bin/goal-gen" \
  node plugins/yellow-goal/tests/release-smoke.mjs
