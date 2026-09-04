#!/usr/bin/env bash
# Same public-artifact compatibility gate for same-repository and fork CI.
# No authentication, source imports, live providers, or engine execution verbs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${TMPDIR:?Set TMPDIR to the isolated runtime directory}"
consumer="$(mktemp -d "$TMPDIR/goal-release-consumer.XXXXXX")"
trap 'rm -rf -- "$consumer"' EXIT
curl --fail --location --retry 3 --output "$consumer/goal-gen-0.1.0.tgz" \
  https://github.com/KingInYellows/yellow-goal/releases/download/v0.1.0/goal-gen-0.1.0.tgz
npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund "$consumer/goal-gen-0.1.0.tgz"
GOAL_GEN_BIN="$consumer/node_modules/.bin/goal-gen" node plugins/yellow-goal/tests/release-smoke.mjs
