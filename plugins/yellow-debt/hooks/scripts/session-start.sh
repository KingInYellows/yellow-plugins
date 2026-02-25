#!/bin/bash
# session-start.sh — Remind about high/critical debt findings pending triage
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# Budget: 2s total
# Output: JSON with systemMessage if high/critical findings exist, empty otherwise

set -uo pipefail

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
count=0

# Try filename pattern first (fast path)
for f in "$TODOS_DIR"/*-pending-critical-*.md "$TODOS_DIR"/*-pending-high-*.md \
         "$TODOS_DIR"/*-ready-critical-*.md "$TODOS_DIR"/*-ready-high-*.md; do
  [ -f "$f" ] && count=$((count + 1))
done

# Fallback: grep frontmatter if no filename matches found
if [ "$count" -eq 0 ]; then
  for f in "$TODOS_DIR"/*.md; do
    [ -f "$f" ] || continue
    # Check first 10 lines for status and severity in frontmatter
    if head -10 "$f" | grep -qE '^status:\s*(pending|ready)' 2>/dev/null; then
      if head -10 "$f" | grep -qE '^severity:\s*(high|critical)' 2>/dev/null; then
        count=$((count + 1))
      fi
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
