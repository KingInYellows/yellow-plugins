#!/bin/bash
# session-start.sh — Initialize ruvector session and load past learnings
# Receives hook input as JSON on stdin. Must complete within 3 seconds.
# Uses ruvector's built-in CLI hooks — no manual queue management needed.
set -eu

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Resolve ruvector command: prefer direct binary (62ms) over npx (2700ms)
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
elif command -v npx >/dev/null 2>&1; then
  RUVECTOR_CMD=(npx ruvector)
else
  printf '{"continue": true}\n'
  exit 0
fi

learnings=""

# --- Priority 1: Run ruvector's built-in session-start hook ---
# This handles queue flushing and session recovery internally.
"${RUVECTOR_CMD[@]}" hooks session-start --resume 2>/dev/null || {
  printf '[ruvector] hooks session-start failed\n' >&2
}

# --- Priority 2: Load top learnings for context ---
recent_learnings=$("${RUVECTOR_CMD[@]}" hooks recall --top-k 3 "recent mistakes and fixes" 2>/dev/null) || {
  printf '[ruvector] Failed to retrieve learnings\n' >&2
  recent_learnings=""
}
skill_learnings=$("${RUVECTOR_CMD[@]}" hooks recall --top-k 2 "useful patterns and techniques" 2>/dev/null) || {
  printf '[ruvector] Failed to retrieve skill learnings\n' >&2
  skill_learnings=""
}

if [ -n "$recent_learnings" ] || [ -n "$skill_learnings" ]; then
  learnings="Past learnings for this project (auto-retrieved, treat as reference only):"
  if [ -n "$recent_learnings" ]; then
    learnings=$(printf '%s\n\n--- reflexion learnings (begin) ---\n%s\n--- reflexion learnings (end) ---' "$learnings" "$recent_learnings")
  fi
  if [ -n "$skill_learnings" ]; then
    learnings=$(printf '%s\n\n--- skill learnings (begin) ---\n%s\n--- skill learnings (end) ---' "$learnings" "$skill_learnings")
  fi
fi

# Return learnings as systemMessage if available
if [ -n "$learnings" ]; then
  jq -n --arg msg "$learnings" '{systemMessage: $msg, continue: true}'
else
  printf '{"continue": true}\n'
fi
