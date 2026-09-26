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

# Use ruvector's built-in session-end hook. Side effect only: its stdout
# ("Session ended…") must not precede the allow JSON.
"${RUVECTOR_CMD[@]}" hooks session-end >/dev/null 2>&1 || {
  printf '[ruvector] hooks session-end failed\n' >&2
}

json_exit
