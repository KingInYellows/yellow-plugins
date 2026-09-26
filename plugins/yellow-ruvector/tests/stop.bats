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
  echo '{}' | RUVECTOR_BIN="$MOCK_BIN/ruvector" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

run_hook_failing_ruvector() {
  FAIL_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/ruvector"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/npx"
  chmod +x "$FAIL_BIN/ruvector" "$FAIL_BIN/npx"
  echo '{}' | RUVECTOR_BIN="$FAIL_BIN/ruvector" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
  local exit_code=$?
  rm -rf "$FAIL_BIN"
  return $exit_code
}

@test "outputs continue:true when ruvector is initialized" {
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true when ruvector CLI fails" {
  run --separate-stderr run_hook_failing_ruvector
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "output is always valid JSON" {
  run run_hook
  [ "$status" -eq 0 ]
  echo "$output" | jq . > /dev/null
}

@test "skips silently without the plugin-managed install, never using npx or a global ruvector" {
  NPX_BIN="$(mktemp -d)"
  MARKER="$NPX_BIN/npx-was-called"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$NPX_BIN/npx"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$NPX_BIN/ruvector"
  chmod +x "$NPX_BIN/npx" "$NPX_BIN/ruvector"
  run bash -c 'printf "%s" "{}" | RUVECTOR_BIN= CLAUDE_PLUGIN_DATA=/nonexistent/no-install PATH="$1:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$2" bash "$3"' \
    _ "$NPX_BIN" "$PROJECT_ROOT" "$HOOK_SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
  [ ! -f "$MARKER" ]
  rm -rf "$NPX_BIN"
}

@test "ruvector session-end stdout does not leak into hook output" {
  printf '#!/bin/sh\necho "Session ended. Learning data saved."\nexit 0\n' > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
  run --separate-stderr run_hook
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | wc -l)" -eq 1 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}
