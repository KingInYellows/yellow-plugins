#!/usr/bin/env bash
# PreToolUse hook: block raw `git push` in favour of `gt submit`.
#
# Claude Code passes the tool input as JSON on stdin.
# Exit 0 → allow the action.
# Exit 2 → block the action and show the message on stderr to the user.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  printf '⛔  `jq` is not installed. This hook requires `jq` to parse tool input.\n' >&2
  printf '   Blocking command to be safe. Please install `jq`.\n' >&2
  exit 2
fi

INPUT=$(cat)

# Extract the command string from the Bash tool input.
# The JSON shape is: { "command": "..." }
COMMAND=$(printf '%s' "$INPUT" | jq -r '.command // ""')

if printf '%s' "$COMMAND" | grep -qE '(^|[;&()|$]|[[:space:]])git[[:space:]]+push'; then
  printf '⛔  Raw `git push` is not allowed in this repo.\n' >&2
  printf '   Use `gt submit --no-interactive` instead so Graphite keeps the stack in sync.\n' >&2
  printf '   If you need to force-push a single branch, use `gt submit` which handles it safely.\n' >&2
  exit 2
fi

exit 0
