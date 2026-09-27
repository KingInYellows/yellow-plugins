#!/bin/bash
# pre-tool-use.sh — surface co-edit suggestions before an edit.
# Receives hook input as JSON on stdin. Budget: <1s (jq only, no ruvector CLI).
#
# On Edit/Write/MultiEdit, the first time a session edits a file (tracked for
# the session's 200 most recently suggested files), look up
# files that were edited together with it at least COEDIT_MIN_COUNT (3) times
# (.ruvector/coedit.json, recorded by post-tool-use.sh) and return up to 3 as
# hookSpecificOutput.additionalContext, fenced as reference data. Claude Code
# shows PreToolUse additionalContext to the model as a system message; it is
# not a permission decision.
#
# Stdout is always dual-client allow JSON (`continue` + `permission`): Cursor's
# Claude-plugin bridge treats empty or non-JSON PreToolUse stdout as a block.
#
# Earlier versions ran ruvector's `hooks pre-edit` / `hooks pre-command` in
# the background and discarded their output (the only thing they produced).
set -uo pipefail
# Note: -e omitted intentionally — hook must output allow JSON on all paths

_HOOK_LIB="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/hook-json.sh
# Decision payload via json_exit: {"continue": true, "permission": "allow"}
. "${_HOOK_LIB}/hook-json.sh"
# shellcheck source=lib/resolve.sh
. "${_HOOK_LIB}/resolve.sh"
# shellcheck source=lib/coedit.sh
. "${_HOOK_LIB}/coedit.sh"
unset _HOOK_LIB

command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping pre-tool-use"

# Parsed straight from stdin, never buffered first, and bounded by
# COEDIT_PARSE_SECS (0.15s): a Write carrying megabytes of content must not
# keep the hook past its 1s timeout (Cursor's bridge reads empty PreToolUse
# stdout as a block). The time is charged against the lock budget below.
COEDIT_PARSE_SECS="${COEDIT_PARSE_SECS:-0.15}"
COEDIT_PARSE_TRIES="${COEDIT_PARSE_TRIES:-3}"

TOOL="" file_path="" session_id="" CWD=""
{
  IFS= read -r -d '' TOOL
  IFS= read -r -d '' file_path
  IFS= read -r -d '' session_id
  IFS= read -r -d '' CWD
} < <(COEDIT_JQ_SECS=$COEDIT_PARSE_SECS coedit_jq -j '
  # A NUL inside a value would read as a field separator (a crafted
  # file_path could forge the session and cwd): such a value is "".
  def s(v): if (v|type) == "string" and (v | test("\u0000") | not) then v else "" end;
  s(.tool_name), "\u0000",
  s(.tool_input.file_path), "\u0000",
  s(.session_id), "\u0000",
  s(.cwd), "\u0000"
' 2>/dev/null) || json_exit "Warning: jq parse failed; skipping pre-tool-use"

case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) json_exit ;;
esac
[ -n "$file_path" ] || json_exit

# The project-root lookup (git rev-parse) is bounded and charged against
# the lock budget, so a slow checkout skips the suggestion instead of
# outliving the hook timeout. TIMEOUT_CMD is cleared so run_budgeted uses
# its background runner (timeout(1) cannot run a shell function).
COEDIT_ROOT_SECS="${COEDIT_ROOT_SECS:-0.15}"
COEDIT_ROOT_TRIES="${COEDIT_ROOT_TRIES:-3}"
_COEDIT_SPENT_TRIES=$((COEDIT_PARSE_TRIES + COEDIT_ROOT_TRIES))
PROJECT_DIR=$(TIMEOUT_CMD='' run_budgeted "$COEDIT_ROOT_SECS" ruvector_resolve_root "${CWD:-${CLAUDE_PROJECT_DIR:-$PWD}}")
[ -n "$PROJECT_DIR" ] && [ -f "${PROJECT_DIR}/.ruvector/coedit.json" ] || json_exit

case "$file_path" in
  /*) ;;
  *) file_path="${CWD:-$PROJECT_DIR}/${file_path}" ;;
esac

context=$(coedit_suggest_once "$PROJECT_DIR" "$session_id" "$file_path")
[ -n "$context" ] || json_exit

emit_recall_json "PreToolUse" "$context"
exit 0
