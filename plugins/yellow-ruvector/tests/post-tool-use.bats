#!/usr/bin/env bats
# Tests for hooks/scripts/post-tool-use.sh — allow JSON only; the hook never
# runs ruvector (its post-edit / post-command write hash-embedded memories
# that stamp a fresh store hash/64d, ADR-210).
bats_require_minimum_version 1.5.0

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "$PROJECT_ROOT/.ruvector"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/post-tool-use.sh"
  MOCK_BIN="$(mktemp -d)"
  MARKER="$MOCK_BIN/cli-called"
  for b in ruvector npx node; do
    printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$MOCK_BIN/$b"
    chmod +x "$MOCK_BIN/$b"
  done
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

run_hook() {
  printf '%s' "$1" | PATH="$MOCK_BIN:$PATH" RUVECTOR_BIN="$MOCK_BIN/ruvector" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

@test "every event prints only the allow JSON and never runs ruvector, npx, or node" {
  for input in \
    '{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"a.ts"},"tool_response":{"success":true}}' \
    '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"stdout":"","stderr":"","interrupted":false}}' \
    '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"false"},"error":"Exit code 1"}' \
    'not json' ''; do
    run run_hook "$input"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -s 'length')" -eq 1 ]
    printf '%s' "$output" | jq -e '.continue == true and .permission == "allow"' >/dev/null
  done
  [ ! -e "$MARKER" ]
  [ ! -e "$PROJECT_ROOT/.ruvector/intelligence.json" ]
}
