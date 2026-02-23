#!/usr/bin/env bats
# Tests for hooks/scripts/stop.sh
bats_require_minimum_version 1.5.0
# The hook delegates to ruvector CLI (hooks session-end).
# In tests, ruvector is mocked or unavailable, so we assert on exit code
# and continue:true output — not on queue file writes (which no longer exist).

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/stop.sh"
  # Stub ruvector binary that exits 0 silently
  MOCK_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 0\n' > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

run_hook() {
  echo '{}' | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

run_hook_failing_ruvector() {
  FAIL_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/ruvector"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/npx"
  chmod +x "$FAIL_BIN/ruvector" "$FAIL_BIN/npx"
  echo '{}' | PATH="$FAIL_BIN:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
  local exit_code=$?
  rm -rf "$FAIL_BIN"
  return $exit_code
}

@test "outputs continue:true when ruvector is initialized" {
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true when ruvector CLI fails" {
  run --separate-stderr run_hook_failing_ruvector
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "output is always valid JSON" {
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq . > /dev/null
}
