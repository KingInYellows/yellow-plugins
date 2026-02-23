#!/usr/bin/env bats
# Tests for hooks/scripts/user-prompt-submit.sh
bats_require_minimum_version 1.5.0

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/user-prompt-submit.sh"
  # Mock ruvector binary that echoes relevant context
  MOCK_BIN="$(mktemp -d)"
  cat > "$MOCK_BIN/ruvector" << 'EOF'
#!/bin/sh
# Minimal ruvector mock for hooks recall
case "$*" in
  *recall*)
    printf '{"results": [{"content": "Use jq -n --arg for safe JSON construction"}]}\n'
    ;;
  *)
    exit 0
    ;;
esac
EOF
  chmod +x "$MOCK_BIN/ruvector"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

run_hook() {
  local json="$1"
  printf '%s' "$json" | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

run_hook_failing_ruvector() {
  local json="$1"
  FAIL_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/ruvector"
  printf '#!/bin/sh\nexit 127\n' > "$FAIL_BIN/npx"
  chmod +x "$FAIL_BIN/ruvector" "$FAIL_BIN/npx"
  printf '%s' "$json" | PATH="$FAIL_BIN:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
  local exit_code=$?
  rm -rf "$FAIL_BIN"
  return $exit_code
}

make_input() {
  local prompt="$1"
  jq -n --arg prompt "$prompt" --arg cwd "$PROJECT_ROOT" \
    '{"user_prompt": $prompt, "cwd": $cwd}'
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  input=$(make_input "implement a new feature for the project")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  # No systemMessage when ruvector not initialized
  echo "$output" | jq -e '.systemMessage == null' > /dev/null
}

@test "skips injection for prompt shorter than 20 chars" {
  input=$(make_input "gt sync")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  echo "$output" | jq -e '.systemMessage == null' > /dev/null
}

@test "skips injection for exactly 19-char prompt (boundary)" {
  # 19 chars: "1234567890123456789"
  input=$(make_input "1234567890123456789")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  echo "$output" | jq -e '.systemMessage == null' > /dev/null
}

@test "injects context for prompt of exactly 20 chars (boundary)" {
  # 20 chars: "12345678901234567890"
  input=$(make_input "12345678901234567890")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  # Injection must have happened at exactly the threshold
  echo "$output" | jq -e '.systemMessage != null' > /dev/null
}

@test "returns continue:true with systemMessage for valid prompt" {
  input=$(make_input "implement a new feature using the ruvector plugin")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
  echo "$output" | jq -e '.systemMessage != null' > /dev/null
  # systemMessage contains the injection fence markers
  [[ "$(echo "$output" | jq -r '.systemMessage')" == *"ruvector context"* ]]
}

@test "systemMessage contains begin/end fence delimiters" {
  input=$(make_input "implement a new feature using the ruvector plugin")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  msg=$(echo "$output" | jq -r '.systemMessage')
  [[ "$msg" == *"--- begin ruvector context"* ]]
  [[ "$msg" == *"--- end ruvector context ---"* ]]
}

@test "returns continue:true when ruvector CLI fails" {
  input=$(make_input "implement a new feature using the ruvector plugin")
  run --separate-stderr run_hook_failing_ruvector "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles missing user_prompt field gracefully" {
  input="{\"cwd\": \"$PROJECT_ROOT\"}"
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "handles empty JSON input gracefully" {
  run run_hook '{}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true' > /dev/null
}

@test "output is always valid JSON" {
  input=$(make_input "implement a new feature using the ruvector plugin")
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq . > /dev/null
}
