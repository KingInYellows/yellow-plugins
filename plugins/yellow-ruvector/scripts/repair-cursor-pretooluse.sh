#!/usr/bin/env bash
# Wrap empty-stdout ruvector PreToolUse commands so Cursor accepts them.
#
# `ruvector hooks init` (including --minimal) writes PreToolUse commands
# that end in `2>/dev/null || true` and print nothing. Cursor's
# Claude-plugin bridge requires a JSON permission object and blocks
# Shell / Edit when stdout is empty or invalid JSON.
#
# Usage:
#   bash repair-cursor-pretooluse.sh [--dry-run] [settings.json ...]
#
# Default paths (used only when they exist):
#   $HOME/.claude/settings.json
#   ${CLAUDE_PROJECT_DIR:-$PWD}/.claude/settings.json
#
# Only PreToolUse ruvector commands with the empty-stdout pattern are
# wrapped. git-ai, plugin hook scripts, and PostToolUse / SessionStart /
# Stop entries are left untouched. Re-running is a no-op.

set -euo pipefail

DRY_RUN=0
PATHS=()

usage() {
  printf 'Usage: %s [--dry-run] [settings.json ...]\n' "${0##*/}" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    --) shift; break ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      ;;
    *) PATHS+=("$1"); shift ;;
  esac
done
while [ $# -gt 0 ]; do
  PATHS+=("$1")
  shift
done

if [ "${#PATHS[@]}" -eq 0 ]; then
  if [ -f "${HOME}/.claude/settings.json" ]; then
    PATHS+=("${HOME}/.claude/settings.json")
  fi
  project_dir="${CLAUDE_PROJECT_DIR:-${PWD}}"
  if [ -f "${project_dir}/.claude/settings.json" ]; then
    PATHS+=("${project_dir}/.claude/settings.json")
  fi
fi

if [ "${#PATHS[@]}" -eq 0 ]; then
  printf 'No settings.json found. Nothing to repair.\n'
  exit 0
fi

command -v jq >/dev/null 2>&1 || {
  printf 'jq is required.\n' >&2
  exit 1
}

SUFFIX='; printf '\''%s\n'\'' '\''{"continue":true,"permission":"allow"}'\'''

# Count PreToolUse ruvector commands that still need wrapping.
count_needs_wrap() {
  jq -r '
    [(.hooks.PreToolUse // [])[]
      | (.hooks // [])[]
      | select(.command | type == "string")
      | select(.command | test("ruvector"))
      | select(.command | test("2>/dev/null|\\|\\| true"))
      | select(.command | contains("\"permission\":\"allow\"") | not)
      | select(.command | contains("permission\":\"allow\"") | not)
    ] | length
  ' "$1"
}

# Wrap those commands in place. Other hook events and non-ruvector
# commands (git-ai, plugin scripts) are preserved byte-for-byte.
wrap_file() {
  jq --arg suffix "$SUFFIX" '
    if (.hooks.PreToolUse | type) != "array" then .
    else
      .hooks.PreToolUse |= map(
        if (.hooks | type) != "array" then .
        else
          .hooks |= map(
            if (.command | type) == "string"
               and (.command | test("ruvector"))
               and (.command | test("2>/dev/null|\\|\\| true"))
               and (.command | contains("\"permission\":\"allow\"") | not)
            then .command = (.command + $suffix)
            else .
            end
          )
        end
      )
    end
  ' "$1"
}

total_changed=0
for settings_path in "${PATHS[@]}"; do
  case "$settings_path" in
    *..*|*'
'*)
      printf 'Refusing unsafe settings path: %s\n' "$settings_path" >&2
      exit 1
      ;;
  esac
  base="${settings_path##*/}"
  if [ "$base" != "settings.json" ]; then
    printf 'Refusing to edit non-settings.json path: %s\n' "$settings_path" >&2
    exit 1
  fi
  if [ ! -f "$settings_path" ]; then
    printf 'Skipping missing file: %s\n' "$settings_path"
    continue
  fi
  if ! jq -e . "$settings_path" >/dev/null 2>&1; then
    printf 'Invalid JSON, leaving untouched: %s\n' "$settings_path" >&2
    exit 1
  fi

  needs="$(count_needs_wrap "$settings_path")"
  if [ "$needs" = "0" ]; then
    printf 'OK (no unsafe PreToolUse ruvector commands): %s\n' "$settings_path"
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Would wrap %s PreToolUse command(s) in %s\n' "$needs" "$settings_path"
    total_changed=$((total_changed + needs))
    continue
  fi

  backup="${settings_path}.bak-ruvector-cursor"
  cp -p -- "$settings_path" "$backup"

  tmp="$(mktemp "${settings_path}.XXXXXX")"
  wrap_file "$settings_path" > "$tmp"
  mv -- "$tmp" "$settings_path"

  printf 'Wrapped %s PreToolUse command(s) in %s\n' "$needs" "$settings_path"
  printf 'Backup: %s\n' "$backup"
  total_changed=$((total_changed + needs))
done

if [ "$total_changed" -gt 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '\nRe-run without --dry-run to apply. Start a new Cursor agent session after applying.\n'
  else
    printf '\nStart a new Cursor agent session so the repaired PreToolUse hooks are loaded.\n'
  fi
fi
