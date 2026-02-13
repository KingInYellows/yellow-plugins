#!/bin/bash
# stop.sh — Delegate queue flushing to memory-manager agent via systemMessage
# Receives hook input as JSON on stdin. Must complete within 10 seconds.
# Does NOT attempt MCP calls or heavy CLI operations.
set -eu

# Resolve script directory and source shared validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/validate.sh"

# Read hook input from stdin (extract .cwd for project directory resolution)
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

# Canonicalize project directory (consistent with session-start.sh)
PROJECT_DIR="$(canonicalize_project_dir "${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}")"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Check if queue file exists, is not a symlink, and is non-empty
if [ ! -f "$QUEUE_FILE" ] || [ -L "$QUEUE_FILE" ] || [ ! -s "$QUEUE_FILE" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Count pending entries
count=$(wc -l < "$QUEUE_FILE" 2>/dev/null | tr -d ' ' || echo 0)
# Validate numeric
case "$count" in
  ''|*[!0-9]*) count=0 ;;
esac

if [ "$count" -eq 0 ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Return systemMessage asking Claude to flush via memory-manager agent
# Note: This is non-deterministic — Claude may not follow the systemMessage.
# If flush doesn't happen, SessionStart recovers stale queue on next session.
jq -n \
  --arg msg "There are $count pending ruvector updates in .ruvector/pending-updates.jsonl. Please use the ruvector-memory-manager agent to flush them before ending the session." \
  '{systemMessage: $msg, continue: true}' || {
  printf '[ruvector] jq failed to construct stop message\n' >&2
  printf '{"continue": true}\n'
}
