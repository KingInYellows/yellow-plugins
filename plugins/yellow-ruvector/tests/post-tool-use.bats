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
  CALLS="$MOCK_BIN/calls.log"
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexit 0\n' "$CALLS" > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

calls() {
  if [ -f "$CALLS" ]; then
    cat "$CALLS"
  fi
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
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true for Write tool" {
  input='{"tool_name":"Write","tool_input":{"file_path":"output.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true for Bash tool with exit code 0" {
  input='{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_result":{"exit_code":0}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true for Bash tool with non-zero exit code" {
  input='{"tool_name":"Bash","tool_input":{"command":"false"},"tool_result":{"exit_code":1}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "exits silently when .ruvector does not exist" {
  rm -rf "$RUVECTOR_DIR"
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "ignores unknown tool names" {
  input='{"tool_name":"Read","tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "handles non-numeric exit_code gracefully" {
  input='{"tool_name":"Bash","tool_input":{"command":"test"},"tool_result":{"exit_code":"abc"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "handles missing tool_name gracefully" {
  input='{"tool_input":{"file_path":"file.txt"}}'
  run run_hook "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "outputs continue:true when ruvector CLI fails" {
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run --separate-stderr run_hook_failing_ruvector "$input"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
}

@test "skips silently when binary absent even if npx present (no npx fallback)" {
  # npx resolution (~2700ms) would blow the 1s PostToolUse budget; the hook
  # must skip entirely, never invoking npx.
  NPX_BIN="$(mktemp -d)"
  MARKER="$NPX_BIN/npx-was-called"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$MARKER" > "$NPX_BIN/npx"
  chmod +x "$NPX_BIN/npx"
  input='{"tool_name":"Edit","tool_input":{"file_path":"file.txt"}}'
  run bash -c 'printf "%s" "$1" | PATH="$2:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$3" bash "$4"' \
    _ "$input" "$NPX_BIN" "$PROJECT_ROOT" "$HOOK_SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.continue == true and .permission == "allow"' > /dev/null
  [ ! -f "$MARKER" ]
  rm -rf "$NPX_BIN"
}

@test "Bash PostToolUse success shape records --success once" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"echo hello"},
    tool_response:{stdout:"hello\n", stderr:"", interrupted:false, isImage:false}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ "$(calls)" = "hooks post-command --success -- echo hello" ]
}

@test "Bash PostToolUse without tool_response is not recorded" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"echo hello"}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "Bash PostToolUse interrupted is not recorded as success or failure" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"sleep 30"},
    tool_response:{stdout:"", stderr:"", interrupted:true, isImage:false}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "legacy tool_result.exit_code is not a success or a fabricated failure" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"echo hello"},
    tool_result:{exit_code:0}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"false"},
    tool_result:{exit_code:"abc"}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "PostToolUseFailure Exit code N is recorded once and not as success" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUseFailure", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"npm test"},
    error:"Exit code 2\nboom", is_interrupt:false
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ "$(calls)" = "hooks post-command --error exit code 2 -- npm test" ]
}

@test "PostToolUseFailure interrupt and bare error are not recorded" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUseFailure", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"sleep 9"},
    error:"aborted", is_interrupt:true
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUseFailure", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"npm test"},
    error:"Command timed out after 2m 0s", is_interrupt:false
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "Edit PostToolUse records --success and a failure event does not" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"Edit", cwd:$cwd,
    tool_input:{file_path:"src/a.ts"},
    tool_response:{filePath:"src/a.ts", type:"update"}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ "$(calls)" = "hooks post-edit --success -- src/a.ts" ]
  : > "$CALLS"
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUseFailure", tool_name:"Edit", cwd:$cwd,
    tool_input:{file_path:"src/a.ts"},
    error:"Edit failed", is_interrupt:false
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "Write without a host event is not recorded as success" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    tool_name:"Write", cwd:$cwd, tool_input:{file_path:"out.txt"}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ -z "$(calls)" ]
}

@test "tool_response success wins over a legacy tool_result and is one call" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"Bash", cwd:$cwd,
    tool_input:{command:"echo hello"},
    tool_response:{stdout:"hello\n", stderr:"", interrupted:false, isImage:false},
    tool_result:{exit_code:1}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ "$(calls)" = "hooks post-command --success -- echo hello" ]
}

@test "MultiEdit records each path once" {
  input=$(jq -n --arg cwd "$PROJECT_ROOT" '{
    hook_event_name:"PostToolUse", tool_name:"MultiEdit", cwd:$cwd,
    tool_input:{edits:[{file_path:"a.ts"},{file_path:"a.ts"},{file_path:"b.ts"}]}
  }')
  run run_hook "$input"
  [ "$status" -eq 0 ]
  [ "$(calls)" = $'hooks post-edit --success -- a.ts\nhooks post-edit --success -- b.ts' ]
}

@test "catalog registers PostToolUseFailure on the same script" {
  catalog="$BATS_TEST_DIRNAME/../../../catalog/plugins/yellow-ruvector.json"
  jq -e '.hooks.PostToolUseFailure[0].matcher == "Edit|Write|MultiEdit|Bash"' "$catalog" > /dev/null
  jq -e '.hooks.PostToolUseFailure[0].hooks[0].command | contains("post-tool-use.sh")' "$catalog" > /dev/null
  jq -e '.hooks.PostToolUse[0].hooks[0].command | contains("post-tool-use.sh")' "$catalog" > /dev/null
}
