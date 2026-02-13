#!/usr/bin/env bats
# Tests for hooks/scripts/stop.sh

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  QUEUE_FILE="$RUVECTOR_DIR/pending-updates.jsonl"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/stop.sh"
}

teardown() {
  rm -rf "$PROJECT_ROOT"
}

run_hook() {
  echo '{}' | CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

@test "outputs continue:true when queue is empty" {
  touch "$QUEUE_FILE"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue"'* ]]
}

@test "outputs continue:true when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue": true'* ]] || [[ "$output" == *'"continue":true'* ]]
}

@test "outputs systemMessage when queue has entries" {
  echo '{"type":"file_change","file_path":"test.txt"}' > "$QUEUE_FILE"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'"systemMessage"'* ]]
  [[ "$output" == *'pending ruvector updates'* ]]
}

@test "counts queue entries correctly" {
  echo '{"type":"file_change","file_path":"a.txt"}' > "$QUEUE_FILE"
  echo '{"type":"file_change","file_path":"b.txt"}' >> "$QUEUE_FILE"
  echo '{"type":"bash_result","command":"test"}' >> "$QUEUE_FILE"
  run run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'3 pending'* ]]
}

@test "skips symlinked queue file" {
  rm -f "$QUEUE_FILE"
  ln -s /etc/passwd "$QUEUE_FILE"
  run run_hook
  [ "$status" -eq 0 ]
  # Should NOT output systemMessage for symlink
  [[ "$output" != *'"systemMessage"'* ]]
}
