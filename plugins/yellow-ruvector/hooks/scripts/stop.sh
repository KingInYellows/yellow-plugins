#!/bin/bash
# stop.sh — Run ruvector's session-end hook for cleanup and metrics export
# Receives hook input as JSON on stdin. Must complete within 10 seconds.
set -uo pipefail
# Note: -e omitted intentionally — hook must output allow JSON on all paths

_HOOK_JSON="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/hook-json.sh"
# shellcheck source=lib/hook-json.sh
# Decision payload via json_exit: {"continue": true, "permission": "allow"}
. "$_HOOK_JSON"
unset _HOOK_JSON

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping stop"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Resolve ruvector command: prefer direct binary (62ms) over npx (2700ms)
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
elif command -v npx >/dev/null 2>&1; then
  RUVECTOR_CMD=(npx --no ruvector)
else
  json_exit "Warning: neither ruvector nor npx found"
fi

# Use ruvector's built-in session-end hook
"${RUVECTOR_CMD[@]}" hooks session-end 2>/dev/null || {
  printf '[ruvector] hooks session-end failed\n' >&2
}

json_exit
