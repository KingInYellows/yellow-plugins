#!/bin/bash
# post-tool-use.sh — record co-edits ("files usually edited together").
# Receives hook input as JSON on stdin. Budget: <1s (jq only, no ruvector CLI,
# no Node start).
#
# Registered for PostToolUse on Edit|Write|MultiEdit (a successful edit).
# Each edit updates this session's last-edited file; a different file edited
# by the same session within 60s adds one to that pair in
# .ruvector/coedit.json (see lib/coedit.sh for why the plugin owns this data).
#
# Earlier versions called ruvector's `hooks post-edit` / `hooks post-command`
# here. Both write a near-empty hash-embedded memory per call ("successful
# edit of ts in project", "<cmd> succeeded"): noise in recall, refused on an
# ONNX-stamped store (ADR-210), and on a fresh store the write that stamps it
# hash/64d, which then makes the MCP server refuse every real memory. Their
# co-edit tracking never worked either (lastEditedFile is per-process).
#
# Host contract: tool_input.file_path is the edited file for Edit, Write, and
# MultiEdit (MultiEdit edits[] carry old_string/new_string, not paths).
# session_id is a common hook input field.
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

command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping post-tool-use"

INPUT=$(cat)

TOOL="" file_path="" event="" session_id="" CWD=""
{
  IFS= read -r -d '' TOOL
  IFS= read -r -d '' file_path
  IFS= read -r -d '' event
  IFS= read -r -d '' session_id
  IFS= read -r -d '' CWD
} < <(printf '%s' "$INPUT" | jq -j '
  def s(v): if (v|type) == "string" then v else "" end;
  s(.tool_name), "\u0000",
  s(.tool_input.file_path), "\u0000",
  s(.hook_event_name), "\u0000",
  s(.session_id), "\u0000",
  s(.cwd), "\u0000"
' 2>/dev/null) || json_exit "Warning: jq parse failed; skipping post-tool-use"

# Only a successful edit counts. Anything else (Bash, a failure event, an
# unknown event name) is a no-op.
[ "$event" = "PostToolUse" ] || [ -z "$event" ] || json_exit
case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) json_exit ;;
esac
[ -n "$file_path" ] || json_exit

# Git toplevel of the session cwd, so a subdirectory session uses the root
# store and root-relative paths.
PROJECT_DIR=$(ruvector_resolve_root "${CWD:-${CLAUDE_PROJECT_DIR:-$PWD}}")
[ -d "${PROJECT_DIR}/.ruvector" ] || json_exit

# Claude Code sends absolute paths; a relative one is relative to the cwd.
case "$file_path" in
  /*) ;;
  *) file_path="${CWD:-$PROJECT_DIR}/${file_path}" ;;
esac

coedit_record "$PROJECT_DIR" "$session_id" "$file_path"

json_exit
