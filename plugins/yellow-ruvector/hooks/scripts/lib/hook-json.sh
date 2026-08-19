#!/usr/bin/env bash
# Dual-client allow payload for Claude Code and Cursor.
#
# Claude Code PreToolUse / PostToolUse / SessionStart / Stop /
# UserPromptSubmit read `continue`. Cursor's Claude-plugin bridge
# requires `permission` on PreToolUse and treats empty / non-JSON
# stdout as a hard block. Extra keys are ignored by each host.
#
# Source this file from hook scripts. Do not execute it.

emit_allow_json() {
  printf '%s\n' '{"continue":true,"permission":"allow"}'
}

# json_exit [stderr-message]
# Optional $1 is a warning on stderr; stdout is always the allow payload.
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
  emit_allow_json
  exit 0
}
