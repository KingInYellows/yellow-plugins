#!/bin/bash
# pre-tool-use.sh — Pre-edit context and coedit suggestions
# Receives hook input as JSON on stdin. Dispatches by tool name.
# shellcheck disable=SC2154
set -uo pipefail
# Note: -e omitted intentionally — hook must output allow JSON on all paths

_HOOK_JSON="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/hook-json.sh"
# shellcheck source=lib/hook-json.sh
# Decision payload via json_exit: {"continue": true, "permission": "allow"}
. "$_HOOK_JSON"
unset _HOOK_JSON

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping pre-tool-use"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

# shellcheck source=lib/resolve.sh
. "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/resolve.sh"
# Git toplevel of the session cwd: a subdirectory session still uses the
# root store.
PROJECT_DIR=$(ruvector_resolve_root "${CWD:-${CLAUDE_PROJECT_DIR:-$PWD}}")
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Plugin-managed ruvector CLI (never a global binary, which can skew from the
# pin). Missing install, Node < 20, or an install in progress: skip silently.
ruvector_resolve_bin || json_exit
# ruvector picks its store from process.cwd().
cd "$PROJECT_DIR" 2>/dev/null || json_exit

# Parse fields using NUL-delimited output (avoids eval)
TOOL="" file_path="" command_text=""
{
  IFS= read -r -d '' TOOL
  IFS= read -r -d '' file_path
  IFS= read -r -d '' command_text
} < <(printf '%s' "$INPUT" | jq -j '
  (.tool_name // ""), "\u0000",
  (.tool_input.file_path // ""), "\u0000",
  (.tool_input.command // "" | .[0:200]), "\u0000"
' 2>/dev/null) || json_exit "Warning: jq parse failed; skipping pre-tool-use"

case "$TOOL" in
  Edit|Write)
    if [ -n "$file_path" ]; then
      # Side-effect only: updates ruvector's internal pre-edit state
      "${RUVECTOR_CMD[@]}" hooks pre-edit -- "$file_path" >/dev/null 2>&1 &
      ruvector_lease_pid "$!"
    fi
    ;;
  MultiEdit)
    # MultiEdit uses edits[] array — iterate over each file_path
    while IFS= read -r edit_path; do
      [ -n "$edit_path" ] || continue
      "${RUVECTOR_CMD[@]}" hooks pre-edit -- "$edit_path" >/dev/null 2>&1 &
      ruvector_lease_pid "$!"
    done < <(printf '%s' "$INPUT" | jq -r '.tool_input.edits[]?.file_path // empty' 2>/dev/null)
    ;;
  Bash)
    if [ -n "$command_text" ]; then
      "${RUVECTOR_CMD[@]}" hooks pre-command -- "$command_text" >/dev/null 2>&1 &
      ruvector_lease_pid "$!"
    fi
    ;;
esac

json_exit
