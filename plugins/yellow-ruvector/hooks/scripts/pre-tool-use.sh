#!/bin/bash
# pre-tool-use.sh — Pre-edit context and coedit suggestions
# Receives hook input as JSON on stdin. Dispatches by tool name.
# shellcheck disable=SC2154
set -uo pipefail
# Note: -e omitted intentionally — hook must output {"continue": true} on all paths

# --- json_exit: centralized exit for all early-return paths ---
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping pre-tool-use"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Resolve ruvector command: require direct binary for PreToolUse (1s budget).
# npx fallback (~2700ms) exceeds the timeout and would be killed, so skip entirely.
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
else
  json_exit
fi

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
      "${RUVECTOR_CMD[@]}" hooks pre-edit -- "$file_path" >/dev/null 2>&1 || true
    fi
    ;;
  Bash)
    if [ -n "$command_text" ]; then
      "${RUVECTOR_CMD[@]}" hooks pre-command -- "$command_text" >/dev/null 2>&1 || true
    fi
    ;;
esac

printf '{"continue": true}\n'
