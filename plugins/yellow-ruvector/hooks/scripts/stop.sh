#!/bin/bash
# stop.sh — Run ruvector's session-end hook for cleanup and metrics export
# Receives hook input as JSON on stdin. Must complete within 10 seconds.
set -eu

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Resolve ruvector command: prefer direct binary (62ms) over npx (2700ms)
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD="ruvector"
elif command -v npx >/dev/null 2>&1; then
  RUVECTOR_CMD="npx ruvector"
else
  printf '{"continue": true}\n'
  exit 0
fi

# Use ruvector's built-in session-end hook
$RUVECTOR_CMD hooks session-end 2>/dev/null || {
  printf '[ruvector] hooks session-end failed\n' >&2
}

printf '{"continue": true}\n'
