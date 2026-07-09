#!/usr/bin/env bats
# Tests for hooks/scripts/session-start.sh
bats_require_minimum_version 1.5.0
# The hook delegates to ruvector CLI (hooks session-start / hooks recall)
# under a 3s hooks.json watchdog. These tests prove the per-call timeout
# wrapping: a hanging ruvector binary must not stop {"continue": true} from
# being emitted within budget. NOTE: this suite is the repo's first bats file
# simulating a HANGING binary (sleep stub), not just a failing one.

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/session-start.sh"
  MOCK_BIN="$(mktemp -d)"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

make_ruvector_stub() {
  # $1 = stub body (sh)
  printf '#!/bin/sh\n%s\n' "$1" > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

run_hook() {
  printf '%s' "$1" | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

@test "outputs continue:true with a healthy silent ruvector" {
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "includes recall output as systemMessage" {
  make_ruvector_stub 'case "$2" in recall) echo "mock-learning";; esac
exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  echo "$output" | jq -e '.systemMessage | contains("mock-learning")' > /dev/null
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  make_ruvector_stub 'exit 0'
  run run_hook '{"cwd":""}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "skips silently when binary absent even if npx present (no npx fallback)" {
  # npx resolution (~2700ms) would eat the 3s SessionStart budget before the
  # three CLI calls run; the hook must skip entirely, never invoking npx.
  MARKER="$MOCK_BIN/npx-was-called"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$MOCK_BIN/npx"
  chmod +x "$MOCK_BIN/npx"
  run bash -c 'printf "%s" "{}" | PATH="$1:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$2" bash "$3"' \
    _ "$MOCK_BIN" "$PROJECT_ROOT" "$HOOK_SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ ! -f "$MARKER" ]
}

@test "emits continue:true within 3s budget when ruvector hangs" {
  # A hanging binary must be killed per-call (0.9s resume + 0.8s x2 recall,
  # 2.8s worst case including --kill-after escalation) so JSON lands before
  # the 3s hooks.json watchdog would kill the process.
  command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1 || \
    skip "timeout/gtimeout not available; unwrapped-call fallback is a documented risk"
  make_ruvector_stub 'sleep 30'
  start_ns="$(date +%s%N)"
  case "$start_ns" in *N*) skip "date +%s%N unsupported (BSD date)";; esac
  run --separate-stderr run_hook '{"cwd":""}'
  end_ns="$(date +%s%N)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ "$elapsed_ms" -lt 3000 ]
}

@test "hanging recall still emits continue:true when session-start succeeds fast" {
  # Mixed case: resume returns instantly, both recalls hang — the per-call
  # caps must bound each recall independently.
  command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1 || \
    skip "timeout/gtimeout not available; unwrapped-call fallback is a documented risk"
  make_ruvector_stub 'case "$2" in recall) sleep 30;; esac
exit 0'
  start_ns="$(date +%s%N)"
  case "$start_ns" in *N*) skip "date +%s%N unsupported (BSD date)";; esac
  run --separate-stderr run_hook '{"cwd":""}'
  end_ns="$(date +%s%N)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  [ "$elapsed_ms" -lt 3000 ]
}
