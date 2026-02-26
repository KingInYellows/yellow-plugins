#!/bin/bash
# session-start.sh — Remind about high/critical debt findings pending triage
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# NOTE: stdin (hook JSON payload) is intentionally not read — CLAUDE_PROJECT_DIR is sufficient.
# Budget: 3s total (filesystem 1ms, glob scan ~5ms, fallback grep ~500ms, buffer ~2.5s)
# Output: JSON with systemMessage if high/critical findings exist, empty otherwise

set -euo pipefail

# Require jq for JSON output
command -v jq >/dev/null 2>&1 || {
  printf '{"continue": true}\n'
  exit 0
}

# Use CLAUDE_PROJECT_DIR for portable path construction
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"
TODOS_DIR="${PROJECT_DIR}/todos/debt"

# Exit silently if no todos directory
if [ ! -d "$TODOS_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Count high/critical findings using filename pattern matching
# Todo filenames encode status and severity: {id}-{status}-{severity}-{slug}-{hash}.md
# Only pending/ready status: in-progress findings are already being worked on (not awaiting triage)
count=0

# Try filename pattern first (fast path)
for f in "$TODOS_DIR"/*-pending-critical-*.md "$TODOS_DIR"/*-pending-high-*.md \
         "$TODOS_DIR"/*-ready-critical-*.md "$TODOS_DIR"/*-ready-high-*.md; do
  [ -f "$f" ] && count=$((count + 1))
done

# Fallback: read frontmatter once per file if no filename matches found
if [ "$count" -eq 0 ]; then
  for f in "$TODOS_DIR"/*.md; do
    [ -f "$f" ] || continue
    # Read first 10 lines once, check status and severity in frontmatter
    snippet="$(head -10 "$f" 2>/dev/null)"
    if printf '%s\n' "$snippet" | grep -qE '^status:\s*(pending|ready)' &&
       printf '%s\n' "$snippet" | grep -qE '^severity:\s*(high|critical)'; then
      count=$((count + 1))
    fi
  done
fi

# Output systemMessage if findings exist
if [ "$count" -gt 0 ]; then
  jq -n --arg msg "[yellow-debt] ${count} high/critical debt finding(s) pending triage. Run /debt:status for details." \
    '{"continue": true, "systemMessage": $msg}'
else
  printf '{"continue": true}\n'
fi
