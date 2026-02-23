#!/usr/bin/env bats
# Tests for hooks/scripts/post-tool-use.sh
bats_require_minimum_version 1.5.0
# The hook delegates to ruvector CLI (hooks post-edit / post-command).
# In tests, ruvector is unavailable or mocked, so we assert on exit code
# and continue:true output — not on queue file writes (which no longer exist).

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/post-tool-use.sh"
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

run_hook_failing_ruvector() {
  FAIL_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/ruvector"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/npx"
  chmod +x "$FAIL_BIN/ruvector" "$FAIL_BIN/npx"
  printf '%s' "$1" | PATH="$FAIL_BIN:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
  local exit_code=$?
  rm -rf "$FAIL_BIN"
  return $exit_code
}

@test "outputs continue:true for Edit tool with valid path" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"src-file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for Write tool" {
  input='{"tool_name":"Write","tool_input":{"file_path":"output.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for Bash tool with exit code 0" {
  input='{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"exit_code":0}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true for Bash tool with non-zero exit code" {
  input='{"tool_name":"Bash","tool_input":{"command":"false"},"tool_result":{"exit_code":1}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "ignores unknown tool names" {
  input='{"tool_name":"Read","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles non-numeric exit_code gracefully" {
  input='{"tool_name":"Bash","tool_input":{"command":"test"},"tool_result":{"exit_code":"abc"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles missing tool_name gracefully" {
  input='{"tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "outputs continue:true when ruvector CLI fails" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run --separate-stderr run_hook_failing_ruvector "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}
