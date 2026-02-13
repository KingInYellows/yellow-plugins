#!/usr/bin/env bats
# Tests for hooks/scripts/post-tool-use.sh

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  QUEUE_FILE="$RUVECTOR_DIR/pending-updates.jsonl"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/post-tool-use.sh"
}

teardown() {
  rm -rf "$PROJECT_ROOT"
}

run_hook() {
  printf '%s' "$1" | CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

@test "outputs continue:true for Edit tool with valid path" {
  echo "test" > "$PROJECT_ROOT/src-file.txt"
  input='{"tool_name":"Edit","tool_input":{"file_path":"src-file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue": true'* ]] || [[ "$output" == *'"continue":true'* ]]
}

@test "appends file_change entry for Edit tool" {
  echo "test" > "$PROJECT_ROOT/src-file.txt"
  input='{"tool_name":"Edit","tool_input":{"file_path":"src-file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -f "$QUEUE_FILE" ]
  entry=$(cat "$QUEUE_FILE")
  [[ "$entry" == *'"type":"file_change"'* ]] || [[ "$entry" == *'"type": "file_change"'* ]]
}

@test "appends bash_result entry for Bash tool" {
  input='{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"exit_code":0}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -f "$QUEUE_FILE" ]
  entry=$(cat "$QUEUE_FILE")
  [[ "$entry" == *'"type": "bash_result"'* ]] || [[ "$entry" == *'"type":"bash_result"'* ]]
}

@test "rejects file path with traversal" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"../../etc/passwd"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  # Should not create queue entry
  [ ! -f "$QUEUE_FILE" ] || [ ! -s "$QUEUE_FILE" ]
}

@test "rejects absolute file path" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"/etc/passwd"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ ! -f "$QUEUE_FILE" ] || [ ! -s "$QUEUE_FILE" ]
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue": true'* ]] || [[ "$output" == *'"continue":true'* ]]
}

@test "ignores unknown tool names" {
  input='{"tool_name":"Read","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ ! -f "$QUEUE_FILE" ] || [ ! -s "$QUEUE_FILE" ]
}

@test "handles non-numeric exit_code gracefully" {
  input='{"tool_name":"Bash","tool_input":{"command":"test"},"tool_result":{"exit_code":"abc"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -f "$QUEUE_FILE" ]
  entry=$(cat "$QUEUE_FILE")
  [[ "$entry" == *'"exit_code": 0'* ]] || [[ "$entry" == *'"exit_code":0'* ]]
}

@test "handles missing tool_name gracefully" {
  input='{"tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue": true'* ]] || [[ "$output" == *'"continue":true'* ]]
}
