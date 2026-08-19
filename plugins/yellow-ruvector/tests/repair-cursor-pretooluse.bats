#!/usr/bin/env bats
# Tests for scripts/repair-cursor-pretooluse.sh
bats_require_minimum_version 1.5.0

setup() {
  WORK="$(mktemp -d)"
  SCRIPT="$BATS_TEST_DIRNAME/../scripts/repair-cursor-pretooluse.sh"
}

teardown() {
  rm -rf "$WORK"
}

write_settings() {
  cat > "$WORK/settings.json" <<'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx ruvector@latest hooks pre-command \"$TOOL_INPUT_command\" 2>/dev/null || true",
            "timeout": 2000
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.git-ai/bin/git-ai checkpoint claude --hook-input stdin"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx ruvector@latest hooks post-command \"$TOOL_INPUT_command\" 2>/dev/null || true",
            "timeout": 2000
          }
        ]
      }
    ]
  }
}
EOF
}

@test "wraps unsafe PreToolUse ruvector commands and leaves git-ai / PostToolUse alone" {
  write_settings
  run bash "$SCRIPT" "$WORK/settings.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Wrapped 1 PreToolUse command"* ]]

  wrapped=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$WORK/settings.json")
  [[ "$wrapped" == *'npx ruvector@latest hooks pre-command'* ]]
  [[ "$wrapped" == *'2>/dev/null || true'* ]]
  [[ "$wrapped" == *'{"continue":true,"permission":"allow"}'* ]]

  git_ai=$(jq -r '.hooks.PreToolUse[1].hooks[0].command' "$WORK/settings.json")
  [ "$git_ai" = '/home/user/.git-ai/bin/git-ai checkpoint claude --hook-input stdin' ]

  post=$(jq -r '.hooks.PostToolUse[0].hooks[0].command' "$WORK/settings.json")
  [ "$post" = 'npx ruvector@latest hooks post-command "$TOOL_INPUT_command" 2>/dev/null || true' ]

  [ -f "$WORK/settings.json.bak-ruvector-cursor" ]
}

@test "is idempotent — a second run reports nothing to wrap" {
  write_settings
  bash "$SCRIPT" "$WORK/settings.json" >/dev/null
  first=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$WORK/settings.json")

  run bash "$SCRIPT" "$WORK/settings.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no unsafe PreToolUse ruvector commands"* ]]

  second=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$WORK/settings.json")
  [ "$first" = "$second" ]
}

@test "--dry-run reports the count without writing" {
  write_settings
  original=$(cat "$WORK/settings.json")

  run bash "$SCRIPT" --dry-run "$WORK/settings.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Would wrap 1 PreToolUse command"* ]]
  [ "$(cat "$WORK/settings.json")" = "$original" ]
  [ ! -f "$WORK/settings.json.bak-ruvector-cursor" ]
}

@test "refuses a path that is not named settings.json" {
  printf '{}\n' > "$WORK/other.json"
  run bash "$SCRIPT" "$WORK/other.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"non-settings.json"* ]]
}

@test "exits 0 when no settings files exist and no paths were given" {
  run env -u CLAUDE_PROJECT_DIR HOME="$WORK" bash -c 'cd "$HOME" && bash "$1"' _ "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No settings.json found"* ]]
}

@test "leaves invalid JSON untouched and exits 1" {
  printf 'not-json{{\n' > "$WORK/settings.json"
  run bash "$SCRIPT" "$WORK/settings.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid JSON"* ]]
  grep -q 'not-json{{' "$WORK/settings.json"
  ! jq -e . "$WORK/settings.json" >/dev/null 2>&1
}
