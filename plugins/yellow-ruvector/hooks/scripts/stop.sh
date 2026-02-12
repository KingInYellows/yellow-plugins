#!/bin/bash
# stop.sh — Delegate queue flushing to memory-manager agent via systemMessage
# Receives hook input as JSON on stdin. Must complete within 10 seconds.
# Does NOT attempt MCP calls or heavy CLI operations.
set -eu

# Consume stdin (hook contract requires reading it)
cat > /dev/null

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Check if queue file exists and is non-empty
if [ ! -s "$QUEUE_FILE" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Count pending entries
count=$(wc -l < "$QUEUE_FILE" 2>/dev/null || echo 0)

if [ "$count" -eq 0 ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Return systemMessage asking Claude to flush via memory-manager agent
# Note: This is non-deterministic — Claude may not follow the systemMessage.
# If flush doesn't happen, SessionStart recovers stale queue on next session.
jq -n \
  --arg msg "There are $count pending ruvector updates in .ruvector/pending-updates.jsonl. Please use the ruvector-memory-manager agent to flush them before ending the session." \
  '{systemMessage: $msg, continue: true}'
