#!/bin/bash
# check-commit-message.sh — PostToolUse hook: warn on non-conventional commit messages
# NOTE: This is a warn-only hook. Never exit 2 (blocking). Never include
# commit message content in output (injection surface).
# Budget: 50ms (no network, no file I/O beyond stdin)

set -euo pipefail

# Bound stdin to 64KB to prevent memory issues
INPUT=$(head -c 65536)

# Require jq for safe JSON parsing
command -v jq >/dev/null 2>&1 || {
  printf '{"continue": true}\n'
  exit 0
}

# PostToolUse schema: .tool_input.command (NOT .command — that's PreToolUse)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null) || {
  printf '{"continue": true}\n'
  exit 0
}

# Only check gt modify / gt commit / gt create commands
case "$COMMAND" in
  *"gt modify"*|*"gt commit"*|*"gt create"*) ;;
  *)
    printf '{"continue": true}\n'
    exit 0
    ;;
esac

# Skip validation if command failed
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.tool_result.exit_code // 0' 2>/dev/null) || EXIT_CODE=0
if [ "$EXIT_CODE" != "0" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Extract first non-empty -m flag value (double-quoted form only).
# Known gaps (permissive by design — warn-only hook):
#   - Single-quoted: -m 'message' → not matched, skips validation
#   - Multi -m flags: -m "subject" -m "body" → only first is checked
# These gaps cause false-negatives (no warning), never false-positives or blocks.
MSG=$(printf '%s' "$COMMAND" | grep -oE '\-m "[^"]*"' | head -1 | sed 's/^-m "//;s/"$//') || MSG=""

# If we couldn't extract the message, skip validation (permissive)
if [ -z "$MSG" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Check for conventional commit prefix
if printf '%s' "$MSG" | grep -qE '^(feat|fix|refactor|docs|test|chore|perf|ci|build|revert)(\(.+\))?!?:'; then
  printf '{"continue": true}\n'
  exit 0
fi

# Warn-only — static message, never include commit content
jq -n '{"continue": true, "systemMessage": "[gt-workflow] Commit message does not follow conventional commits. Consider: gt modify -c -m \"type(scope): description\""}'
