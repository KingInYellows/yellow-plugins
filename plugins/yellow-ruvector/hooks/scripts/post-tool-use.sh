#!/bin/bash
# post-tool-use.sh — Record file edits and bash outcomes via ruvector hooks CLI
# Receives hook input as JSON on stdin. Budget: <50ms.
# Uses ruvector's built-in post-edit and post-command hooks.
# shellcheck disable=SC2154
set -eu

# Read hook input from stdin
INPUT=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"
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

# Parse all fields in a single jq invocation
eval "$(printf '%s' "$INPUT" | jq -r '
  @sh "TOOL=\(.tool_name // "")",
  @sh "file_path=\(.tool_input.file_path // "")",
  @sh "command_text=\(.tool_input.command // "" | .[0:200])",
  @sh "exit_code=\(.tool_result.exit_code // 0)"
')" 2>/dev/null || {
  printf '{"continue": true}\n'
  exit 0
}

case "$TOOL" in
  Edit|Write)
    if [ -n "$file_path" ]; then
      # Use ruvector's built-in post-edit hook
      if ! ERR=$($RUVECTOR_CMD hooks post-edit --success "$file_path" 2>&1); then
        printf '[ruvector] post-edit failed for %s: %s\n' "$file_path" "$ERR" >&2
      fi
    fi
    ;;
  Bash)
    if [ -n "$command_text" ]; then
      # Validate exit_code is numeric
      case "$exit_code" in
        ''|*[!0-9]*) exit_code=0 ;;
      esac
      if [ "$exit_code" -eq 0 ]; then
        if ! ERR=$($RUVECTOR_CMD hooks post-command --success "$command_text" 2>&1); then
          printf '[ruvector] post-command failed: %s\n' "$ERR" >&2
        fi
      else
        if ! ERR=$($RUVECTOR_CMD hooks post-command --error "exit code $exit_code" "$command_text" 2>&1); then
          printf '[ruvector] post-command failed: %s\n' "$ERR" >&2
        fi
      fi
    fi
    ;;
esac

printf '{"continue": true}\n'
