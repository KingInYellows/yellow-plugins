#!/bin/bash
# post-tool-use.sh — Append file changes and bash outcomes to pending-updates queue
# Receives hook input as JSON on stdin. Budget: <50ms (append-only, no MCP calls).
# Append-only, non-blocking — NO MCP calls, NO embedding, just file append.
# shellcheck disable=SC2154 # Variables (TOOL, file_path, command_text, exit_code) assigned via eval
set -eu

# Resolve script directory and source shared validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/validate.sh"

# Read hook input from stdin
INPUT=$(cat)

PROJECT_DIR="$(canonicalize_project_dir "${CLAUDE_PROJECT_DIR:-${PWD}}")"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"
LOCK_FILE="${RUVECTOR_DIR}/queue.lock"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Parse all fields in a single jq invocation (avoid 3 separate jq spawns per call)
# All stdin fields are untrusted; variables populated by eval from jq @sh output
eval "$(printf '%s' "$INPUT" | jq -r '
  @sh "TOOL=\(.tool_name // "")",
  @sh "file_path=\(.tool_input.file_path // "")",
  @sh "command_text=\(.tool_input.command // "" | .[0:200])",
  @sh "exit_code=\(.tool_result.exit_code // 0)"
')" 2>/dev/null || {
  # jq parse failure — input is not valid JSON
  printf '{"continue": true}\n'
  exit 0
}

# Append a JSON entry to the queue file with error logging
append_to_queue() {
  local json_output="$1"
  if [ -z "$json_output" ]; then
    printf '[ruvector] jq produced empty output, skipping append\n' >&2
    return 1
  fi
  if ! printf '%s\n' "$json_output" >> "$QUEUE_FILE" 2>&1; then
    printf '[ruvector] Failed to append to queue (disk full or permission denied?)\n' >&2
    return 1
  fi
}

case "$TOOL" in
  Edit|Write)
    # Validate path using shared validation library
    if ! validate_file_path "$file_path" "$PROJECT_DIR"; then
      printf '{"continue": true}\n'
      exit 0
    fi

    # Construct JSON safely with schema version, then append
    json_entry=$(jq -n \
      --arg type "file_change" \
      --arg path "$file_path" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{schema: "1", type: $type, file_path: $path, timestamp: $ts}') || {
      printf '[ruvector] jq failed to construct file_change JSON\n' >&2
      printf '{"continue": true}\n'
      exit 0
    }
    append_to_queue "$json_entry"
    ;;

  Bash)
    # Validate exit_code is numeric
    case "$exit_code" in
      ''|*[!0-9]*) exit_code=0 ;;
    esac

    # Construct JSON safely with schema version, then append
    json_entry=$(jq -n \
      --arg type "bash_result" \
      --arg cmd "$command_text" \
      --argjson exit "$exit_code" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{schema: "1", type: $type, command: $cmd, exit_code: $exit, timestamp: $ts}') || {
      printf '[ruvector] jq failed to construct bash_result JSON\n' >&2
      printf '{"continue": true}\n'
      exit 0
    }
    append_to_queue "$json_entry"
    ;;
esac

# Queue rotation: if queue exceeds 10MB, rotate atomically with flock
if [ -f "$QUEUE_FILE" ] && [ ! -L "$QUEUE_FILE" ]; then
  queue_size=$(stat -c %s "$QUEUE_FILE" 2>/dev/null || echo 0)
  # Validate queue_size is numeric
  case "$queue_size" in
    ''|*[!0-9]*) queue_size=0 ;;
  esac

  if [ "$queue_size" -gt 10485760 ]; then
    if command -v flock >/dev/null 2>&1; then
      (
        flock -n 9 || { printf '[ruvector] Rotation skipped: lock held\n' >&2; exit 0; }
        # Only truncate if mv succeeds (prevents data loss)
        if mv -- "$QUEUE_FILE" "${QUEUE_FILE}.1" 2>&1; then
          : > "$QUEUE_FILE"
          printf '[ruvector] Queue rotated at %s bytes\n' "$queue_size" >&2
        else
          printf '[ruvector] Queue rotation failed (mv error)\n' >&2
        fi
      ) 9>"$LOCK_FILE"
    else
      # No flock available — attempt rotation without lock (best effort)
      if mv -- "$QUEUE_FILE" "${QUEUE_FILE}.1" 2>&1; then
        : > "$QUEUE_FILE"
        printf '[ruvector] Queue rotated at %s bytes (no flock)\n' "$queue_size" >&2
      else
        printf '[ruvector] Queue rotation failed\n' >&2
      fi
    fi
  fi
fi

printf '{"continue": true}\n'
