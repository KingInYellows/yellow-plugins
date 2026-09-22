#!/bin/bash
# post-tool-use.sh — Record file edits and bash outcomes via ruvector hooks CLI
# Receives hook input as JSON on stdin. Budget: <1s.
# Registered for PostToolUse and PostToolUseFailure. Branches on
# hook_event_name. One upstream CLI call per path or command.
#
# Host contract (code.claude.com/docs/en/hooks, fetched 2026-09-21):
#   PostToolUse is a successful tool call. Bash success is tool_response
#   {stdout, stderr, interrupted, isImage}. There is no exit_code field.
#   tool_response.interrupted true is a cancellation; PostToolUseFailure
#   does not fire for that.
#   PostToolUseFailure carries top-level error and is_interrupt. When a
#   shell actually exited, error's first line is "Exit code N".
#   tool_result.exit_code is not a host field. A missing status is
#   unknown: do not submit --success and do not invent an exit code.
# shellcheck disable=SC2154
set -uo pipefail
# Note: -e omitted intentionally — hook must output allow JSON on all paths

_HOOK_JSON="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/hook-json.sh"
# shellcheck source=lib/hook-json.sh
# Decision payload via json_exit: {"continue": true, "permission": "allow"}
. "$_HOOK_JSON"
unset _HOOK_JSON

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping post-tool-use"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r 'if (.cwd | type) == "string" then .cwd else "" end' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Resolve ruvector command: require direct binary for PostToolUse (1s budget).
# npx resolution (~2700ms) exceeds the timeout and would be killed, so skip
# entirely when the binary is absent (same pattern as pre-tool-use.sh).
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
else
  json_exit
fi

# Parse fields using NUL-delimited output (avoids eval). Strings only —
# a non-string tool_input.command is not command text.
TOOL="" file_path="" command_text="" event="" interrupted="0" has_response="0" is_interrupt="0" error_line=""
{
  IFS= read -r -d '' TOOL
  IFS= read -r -d '' file_path
  IFS= read -r -d '' command_text
  IFS= read -r -d '' event
  IFS= read -r -d '' interrupted
  IFS= read -r -d '' has_response
  IFS= read -r -d '' is_interrupt
  IFS= read -r -d '' error_line
} < <(printf '%s' "$INPUT" | jq -j '
  def s(v): if (v|type) == "string" then v else "" end;
  (s(.tool_name)), "\u0000",
  (s(.tool_input.file_path)), "\u0000",
  (if (.tool_input.command|type) == "string" then .tool_input.command[0:200] else "" end), "\u0000",
  (s(.hook_event_name)), "\u0000",
  (if .tool_response.interrupted == true then "1" else "0" end), "\u0000",
  (if (.tool_response|type) == "object" then "1" else "0" end), "\u0000",
  (if .is_interrupt == true then "1" else "0" end), "\u0000",
  (if (.error|type) == "string" then (.error | split("\n")[0]) else "" end), "\u0000"
' 2>/dev/null) || json_exit "Warning: jq parse failed; skipping post-tool-use"

# "Exit code N" as the entire first line. Anything else is not a status.
exit_code=""
case "$error_line" in
  "Exit code "*)
    _maybe="${error_line#Exit code }"
    case "$_maybe" in
      ''|*[!0-9]*) ;;
      *) exit_code="$_maybe" ;;
    esac
    ;;
esac
unset _maybe

# success | failure | interrupt | unknown
outcome="unknown"
if [ "$interrupted" = "1" ] || [ "$is_interrupt" = "1" ]; then
  outcome="interrupt"
elif [ "$event" = "PostToolUse" ]; then
  case "$TOOL" in
    Bash)
      [ "$has_response" = "1" ] && outcome="success"
      ;;
    Edit|Write|MultiEdit)
      outcome="success"
      ;;
  esac
elif [ "$event" = "PostToolUseFailure" ] && [ -n "$exit_code" ]; then
  outcome="failure"
fi

record_edit() {
  local path="$1"
  [ -z "$path" ] && return 0
  case "$path" in
    */docs/solutions/*|docs/solutions/*) return 0 ;;
  esac
  # Only an explicit PostToolUse success is a post-edit --success.
  # Failure, interrupt, and unknown are not submitted (no fabricated flag).
  if [ "$outcome" != "success" ]; then
    return 0
  fi
  if ! ERR=$("${RUVECTOR_CMD[@]}" hooks post-edit --success -- "$path" 2>&1); then
    printf '[ruvector] post-edit failed for %s: %s\n' "$path" "$ERR" >&2
  fi
}

record_bash() {
  [ -z "$command_text" ] && return 0
  case "$outcome" in
    success)
      if ! ERR=$("${RUVECTOR_CMD[@]}" hooks post-command --success -- "$command_text" 2>&1); then
        printf '[ruvector] post-command failed: %s\n' "$ERR" >&2
      fi
      ;;
    failure)
      if ! ERR=$("${RUVECTOR_CMD[@]}" hooks post-command --error "exit code $exit_code" -- "$command_text" 2>&1); then
        printf '[ruvector] post-command failed: %s\n' "$ERR" >&2
      fi
      ;;
  esac
}

case "$TOOL" in
  Edit|Write)
    record_edit "$file_path"
    ;;
  MultiEdit)
    declare -A seen_paths=()
    while IFS= read -r edit_path; do
      [ -z "$edit_path" ] && continue
      [ -n "${seen_paths[$edit_path]+x}" ] && continue
      seen_paths["$edit_path"]=1
      record_edit "$edit_path"
    done < <(printf '%s' "$INPUT" | jq -r '
      if (.tool_input.edits|type) == "array"
      then .tool_input.edits[]? | if (.file_path|type) == "string" then .file_path else empty end
      else empty end
    ' 2>/dev/null)
    ;;
  Bash)
    record_bash
    ;;
esac

json_exit
