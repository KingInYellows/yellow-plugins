#!/usr/bin/env bats
# Tests for scripts/repair-cursor-pretooluse.sh
bats_require_minimum_version 1.5.0

setup() {
  WORK="$(mktemp -d)"
  SCRIPT="$BATS_TEST_DIRNAME/../scripts/repair-cursor-pretooluse.sh"
  # The script only rewrites allowlisted paths, so the fixture lives at the
  # project-settings location of a throwaway CLAUDE_PROJECT_DIR.
  SETTINGS="$WORK/.claude/settings.json"
  mkdir -p "$WORK/.claude"
  export CLAUDE_PROJECT_DIR="$WORK"
}

teardown() {
  rm -rf "$WORK"
}

# $1 (optional) — destination; defaults to $SETTINGS
write_settings() {
  cat > "${1:-$SETTINGS}" <<'EOF'
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
  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Wrapped 1 PreToolUse command"* ]]

  wrapped=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")
  [[ "$wrapped" == *'npx ruvector@latest hooks pre-command'* ]]
  [[ "$wrapped" == *'2>/dev/null || true'* ]]
  [[ "$wrapped" == *'{"continue":true,"permission":"allow"}'* ]]

  git_ai=$(jq -r '.hooks.PreToolUse[1].hooks[0].command' "$SETTINGS")
  [ "$git_ai" = '/home/user/.git-ai/bin/git-ai checkpoint claude --hook-input stdin' ]

  post=$(jq -r '.hooks.PostToolUse[0].hooks[0].command' "$SETTINGS")
  [ "$post" = 'npx ruvector@latest hooks post-command "$TOOL_INPUT_command" 2>/dev/null || true' ]

  [ -f "$SETTINGS.bak-ruvector-cursor" ]
}

@test "is idempotent — a second run reports nothing to wrap" {
  write_settings
  bash "$SCRIPT" "$SETTINGS" >/dev/null
  first=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")

  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no unsafe PreToolUse ruvector commands"* ]]

  second=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")
  [ "$first" = "$second" ]
}

@test "leaves a PreToolUse hook that already prints its own decision alone" {
  cat > "$SETTINGS" <<'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx ruvector@latest hooks pre-command \"$TOOL_INPUT_command\" 2>/dev/null; printf '%s' '{\"permission\": \"allow\"}'"
          },
          {
            "type": "command",
            "command": "$HOME/.ruvector-wrapper.sh 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
EOF
  original=$(cat "$SETTINGS")

  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no unsafe PreToolUse ruvector commands"* ]]
  [ "$(cat "$SETTINGS")" = "$original" ]
}

@test "--dry-run reports the count without writing" {
  write_settings
  original=$(cat "$SETTINGS")

  run bash "$SCRIPT" --dry-run "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Would wrap 1 PreToolUse command"* ]]
  [ "$(cat "$SETTINGS")" = "$original" ]
  [ ! -f "$SETTINGS.bak-ruvector-cursor" ]
}

@test "refuses an explicit path outside the allowlist" {
  printf '{}\n' > "$WORK/settings.json"
  run bash "$SCRIPT" "$WORK/settings.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *"outside the allowlist"* ]]
  [ "$(cat "$WORK/settings.json")" = '{}' ]
}

# GNU stat first, BSD/macOS stat second.
file_mode() {
  stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"
}

@test "preserves the settings file mode across the rewrite" {
  write_settings
  chmod 644 "$SETTINGS"

  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Wrapped 1 PreToolUse command"* ]]

  [ "$(file_mode "$SETTINGS")" = "644" ]
}

@test "repairs through a symlink without replacing the link" {
  mkdir -p "$WORK/dotfiles"
  write_settings "$WORK/dotfiles/settings.json"
  rm -f "$SETTINGS"
  ln -s "$WORK/dotfiles/settings.json" "$SETTINGS"

  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Wrapped 1 PreToolUse command"* ]]

  [ -L "$SETTINGS" ]
  wrapped=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$WORK/dotfiles/settings.json")
  [[ "$wrapped" == *'{"continue":true,"permission":"allow"}'* ]]
  [ -f "$WORK/dotfiles/settings.json.bak-ruvector-cursor" ]
}

@test "exits 0 when no settings files exist and no paths were given" {
  run env -u CLAUDE_PROJECT_DIR HOME="$WORK" bash -c 'cd "$HOME" && bash "$1"' _ "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No settings.json found"* ]]
}

@test "leaves invalid JSON untouched and exits 1" {
  printf 'not-json{{\n' > "$SETTINGS"
  run bash "$SCRIPT" "$SETTINGS"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid JSON"* ]]
  grep -q 'not-json{{' "$SETTINGS"
  ! jq -e . "$SETTINGS" >/dev/null 2>&1
}
