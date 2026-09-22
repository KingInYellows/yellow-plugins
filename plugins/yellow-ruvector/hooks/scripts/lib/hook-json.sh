#!/usr/bin/env bash
# Dual-client allow payload for Claude Code and Cursor.
#
# Claude Code PreToolUse / PostToolUse / SessionStart / Stop /
# UserPromptSubmit read `continue`. Cursor's Claude-plugin bridge
# requires `permission` on PreToolUse and treats empty / non-JSON
# stdout as a hard block. Extra keys are ignored by each host.
# `permission` here is that bridge field. It is not Claude's
# permissionDecision and does not authorize a tool or a prompt.
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

# emit_recall_json <hookEventName> <additionalContext> [systemMessage]
# Model-facing recalled text goes in hookSpecificOutput.additionalContext
# (UserPromptSubmit and SessionStart). Operator diagnostics go in
# systemMessage, which is shown to the user. Either string may be empty;
# an empty field is omitted. Does not emit `decision` or
# `permissionDecision`. Falls back to the plain allow payload if jq fails
# so the hook never emits empty stdout. Requires jq — callers gate on it.
emit_recall_json() {
  local event="$1"
  local context="$2"
  local diag="${3:-}"
  if [ "${#context}" -gt 8000 ]; then
    context="${context:0:7900}"$'\n''[ruvector] recalled context truncated'
  fi
  jq -n \
    --arg event "$event" \
    --arg ctx "$context" \
    --arg diag "$diag" \
    '{continue:true, permission:"allow"}
     + (if $diag != "" then {systemMessage:$diag} else {} end)
     + (if $ctx != "" then {hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}} else {} end)' \
    || emit_allow_json
}
