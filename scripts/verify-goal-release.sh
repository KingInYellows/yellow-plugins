#!/usr/bin/env bash
# Same public-artifact compatibility gate for same-repository and fork CI.
# No authentication, source imports, live providers, or real executors.
# The pinned version, asset URL, and SHA-256 below are kept in agreement
# with plugins/yellow-goal/src/pin.ts by tests/release-pin.test.ts.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${TMPDIR:?Set TMPDIR to the isolated runtime directory}"

PINNED_ENGINE_VERSION="0.3.0"
PINNED_ENGINE_TAG="v0.3.0"
PINNED_ENGINE_COMMIT="2f336d548523f795fef95f43fb03d751c2d65b80"
PINNED_ENGINE_ASSET_URL="https://github.com/KingInYellows/yellow-goal/releases/download/v0.3.0/goal-gen-0.3.0.tgz"
PINNED_ENGINE_ASSET_SHA256="16e9d4b84f8b771ca1c368c886da70ef0d29c5e2af5ba68a51094c20f0a5db23"

case "$PINNED_ENGINE_ASSET_URL" in
  *"/releases/download/${PINNED_ENGINE_TAG}/goal-gen-${PINNED_ENGINE_VERSION}.tgz") ;;
  *)
    echo "released goal-gen pin URL does not match ${PINNED_ENGINE_TAG} / ${PINNED_ENGINE_VERSION}" >&2
    exit 1
    ;;
esac
if [ "${#PINNED_ENGINE_COMMIT}" -ne 40 ]; then
  echo "pinned engine commit must be 40 characters" >&2
  exit 1
fi

consumer="$(mktemp -d "$TMPDIR/goal-release-consumer.XXXXXX")"
trap 'rm -rf -- "$consumer"' EXIT
asset="$consumer/goal-gen-${PINNED_ENGINE_VERSION}.tgz"
curl --fail --silent --show-error --location --retry 3 --output "$asset" \
  "$PINNED_ENGINE_ASSET_URL"

# Verify the public asset hash BEFORE anything from it is installed.
# GitHub-hosted Linux runners ship sha256sum; macOS developers have shasum.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "neither sha256sum nor shasum is available to verify the release asset" >&2
    return 1
  fi
}
actual_sha="$(sha256_of "$asset")"
if [ "$actual_sha" != "$PINNED_ENGINE_ASSET_SHA256" ]; then
  echo "released goal-gen asset SHA-256 mismatch: expected $PINNED_ENGINE_ASSET_SHA256, got $actual_sha" >&2
  exit 1
fi

npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund "$asset"
GOAL_GEN_BIN="$consumer/node_modules/.bin/goal-gen" \
  node plugins/yellow-goal/tests/release-smoke.mjs
GOAL_GEN_BIN="$consumer/node_modules/.bin/goal-gen" \
  node plugins/yellow-goal/tests/release-protocol-smoke.mjs
