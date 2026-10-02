#!/bin/bash
# session-start.sh — Remind about high/critical debt findings pending triage
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# NOTE: stdin (hook JSON payload) is intentionally not read — CLAUDE_PROJECT_DIR is sufficient.
# Budget: 3s total (filesystem 1ms, glob scan ~5ms, regex match ~1ms per file, buffer ~2.5s)
# Output: JSON with systemMessage if high/critical findings exist, empty otherwise

# Intentionally omit -e: SessionStart hooks must always output {"continue": true}.
# With -e, any unexpected command failure would exit without JSON, blocking startup.
set -uo pipefail

# Require jq for JSON output
command -v jq >/dev/null 2>&1 || {
  printf '[yellow-debt] Warning: jq not found; session-start hook skipped\n' >&2
  printf '{"continue": true}\n'
  exit 0
}

# Use CLAUDE_PROJECT_DIR for portable path construction
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
  printf '[yellow-debt] Warning: CLAUDE_PROJECT_DIR unset; falling back to PWD (%s)\n' "$PWD" >&2
  PROJECT_DIR="$PWD"
else
  PROJECT_DIR="$CLAUDE_PROJECT_DIR"
fi
TODOS_DIR="${PROJECT_DIR}/todos/debt"

# Exit silently if no todos directory (or a symlinked one a cloned
# repository could point anywhere)
if [ ! -d "$TODOS_DIR" ] || [ -L "$TODOS_DIR" ] || [ -L "${PROJECT_DIR}/todos" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Count high/critical findings by matching the full structured filename:
# {id}-{status}-{severity}-{slug}[-{hash}].md (lib/validate.sh
# DEBT_TODO_NAME_RE). Names outside it — e.g. carrying `$(…)` — are not
# counted, matching what /debt:triage lists. Anchored to position, so slugs
# containing status/severity keywords are not double-counted. in-progress is
# excluded: already being worked on. Terminal and parked statuses (complete,
# deleted, deferred, wont-fix) are excluded too: only pending|ready count.
count=0
for f in "$TODOS_DIR"/*.md; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  base="$(basename "$f")"
  if [[ "$base" =~ ^[0-9]{1,6}-(pending|ready)-(critical|high)-[a-z0-9]+(-[a-z0-9]+)*\.md$ ]]; then
    count=$((count + 1))
  fi
done

# Output systemMessage if findings exist
if [ "$count" -gt 0 ]; then
  jq -n --arg msg "[yellow-debt] ${count} high/critical debt finding(s) pending triage. Run /debt:status for details." \
    '{"continue": true, "systemMessage": $msg}' || {
    printf '[yellow-debt] Error: jq failed to build systemMessage\n' >&2
    printf '{"continue": true}\n'
  }
else
  printf '{"continue": true}\n'
fi
