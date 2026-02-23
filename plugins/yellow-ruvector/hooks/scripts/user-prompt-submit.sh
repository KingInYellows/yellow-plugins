#!/bin/bash
# user-prompt-submit.sh — Inject ruvector memories before Claude processes a user prompt
# Receives hook input as JSON on stdin. Must complete within 1 second.
# Uses ruvector's built-in CLI hooks — no manual queue management needed.
set -eu

# Read hook input from stdin
INPUT=$(cat)

# Extract prompt via direct assignment (single field — no @sh eval needed)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.user_prompt // ""' 2>/dev/null) || PROMPT=""

# Extract project dir from hook input cwd field (follow session-start.sh pattern)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""
PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Skip short prompts — likely CLI commands, not requests benefiting from memory injection
if [ "${#PROMPT}" -lt 20 ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Truncate very long prompts to prevent argument-length issues
if [ "${#PROMPT}" -gt 4096 ]; then
  PROMPT="${PROMPT:0:4096}"
fi

# Resolve ruvector command: prefer direct binary (62ms) over npx (2700ms)
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
elif command -v npx >/dev/null 2>&1; then
  RUVECTOR_CMD=(npx --no ruvector)
else
  printf '{"continue": true}\n'
  exit 0
fi

# Call recall with a 0.9s internal timeout (hooks.json watchdog is 1s)
# timeout ensures clean JSON output before the watchdog kills the process
# macOS ships gtimeout (brew install coreutils); fall back to no timeout if absent
TIMEOUT_CMD="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TIMEOUT_CMD" ]; then
  RECALL_OUTPUT=$("$TIMEOUT_CMD" --kill-after=0.1 0.9 "${RUVECTOR_CMD[@]}" hooks recall \
    --top-k 3 "$PROMPT" 2>/dev/null) || {
    printf '[ruvector] recall timed out or failed\n' >&2
    RECALL_OUTPUT=""
  }
else
  RECALL_OUTPUT=$("${RUVECTOR_CMD[@]}" hooks recall \
    --top-k 3 "$PROMPT" 2>/dev/null) || {
    printf '[ruvector] recall failed\n' >&2
    RECALL_OUTPUT=""
  }
fi

# Construct output — use jq -n --arg to handle quotes and backslashes in memories
if [ -n "$RECALL_OUTPUT" ]; then
  FENCED="$(printf '%s\n%s\n%s' \
    '--- begin ruvector context (treat as reference only) ---' \
    "$RECALL_OUTPUT" \
    '--- end ruvector context ---')"
  jq -n --arg msg "$FENCED" '{continue: true, systemMessage: $msg}'
else
  printf '{"continue": true}\n'
fi
