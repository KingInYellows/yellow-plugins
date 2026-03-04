#!/usr/bin/env bats
# Tests for hooks/scripts/pre-tool-use.sh
bats_require_minimum_version 1.5.0
# The hook delegates to ruvector CLI (hooks pre-edit / pre-command).
# In tests, ruvector is mocked, so we assert on exit code
# and continue:true output — not on ruvector side-effects.

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/pre-tool-use.sh"
  # Stub ruvector binary that exits 0 silently
  MOCK_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 0\n' > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

run_hook() {
  printf '%s' "$1" | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

run_hook_no_ruvector() {
  # PATH with only system utilities — no ruvector binary
  printf '%s' "$1" | PATH="/usr/bin:/bin" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

# --- Core output contract ---

@test "outputs continue:true for Edit tool with valid file_path" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for Write tool with valid file_path" {
  input='{"tool_name":"Write","tool_input":{"file_path":"out.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for Bash tool with command" {
  input='{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

# --- Early exit: .ruvector directory missing ---

@test "exits 0 with continue:true when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

# --- Early exit: ruvector binary not found ---

@test "exits 0 with continue:true when ruvector binary not on PATH" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run run_hook_no_ruvector "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

# --- Tool dispatch: MultiEdit iterates edits array ---

@test "outputs continue:true for MultiEdit with edits array" {
  input='{"tool_name":"MultiEdit","tool_input":{"edits":[{"file_path":"a.txt"},{"file_path":"b.txt"}]}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for unknown tool name" {
  input='{"tool_name":"Read","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

# --- Graceful handling of bad input ---

@test "handles missing tool_name gracefully" {
  input='{"tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles completely empty input gracefully" {
  run --separate-stderr run_hook ""
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles malformed JSON input gracefully" {
  run --separate-stderr run_hook "not-json{{"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

# --- Ruvector stdout isolation ---

@test "ruvector stdout does not leak into hook output" {
  # Mock ruvector that writes to stdout — should not appear in hook output
  NOISY_BIN="$(mktemp -d)"
  printf '#!/bin/sh\necho "LEAKED"\nexit 0\n' > "$NOISY_BIN/ruvector"
  chmod +x "$NOISY_BIN/ruvector"
  input='{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}'
  output=$(printf '%s' "$input" | PATH="$NOISY_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT")
  status=$?
  rm -rf "$NOISY_BIN"
  [ "$status" -eq 0 ]
  # Output must be only the JSON line — no "LEAKED"
  [ "$(echo "$output" | wc -l)" -eq 1 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}
