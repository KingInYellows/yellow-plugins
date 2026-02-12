#!/bin/bash
# post-tool-use.sh — Append file changes and bash outcomes to pending-updates queue
# Receives hook input as JSON on stdin. Must complete within 1 second.
# Append-only, non-blocking — NO MCP calls, NO embedding, just file append.
set -eu

# Read hook input from stdin
INPUT=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Extract tool name — all stdin fields are untrusted
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')

# Validate file_path is within project root (path traversal mitigation)
validate_file_path() {
  local raw_path="$1"
  local project_root="$2"

  # Quick reject: obvious traversal patterns
  case "$raw_path" in
    *..* | /* | *~*) return 1 ;;
  esac

  # Empty path is invalid
  if [ -z "$raw_path" ]; then
    return 1
  fi

  # Normalize and resolve to absolute path
  local resolved
  resolved="$(realpath -m -- "${project_root}/${raw_path}" 2>/dev/null)" || return 1

  # Verify resolved path is under project root
  case "$resolved" in
    "${project_root}/"*) return 0 ;;
    *) return 1 ;;
  esac
}

case "$TOOL" in
  Edit|Write)
    # Extract file_path from tool_input
    file_path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')

    # Validate path
    if ! validate_file_path "$file_path" "$PROJECT_DIR"; then
      printf '{"continue": true}\n'
      exit 0
    fi

    # Append to queue using jq for safe JSON construction
    jq -n \
      --arg type "file_change" \
      --arg path "$file_path" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{type: $type, file_path: $path, timestamp: $ts}' \
      >> "$QUEUE_FILE" 2>/dev/null || true
    ;;

  Bash)
    # Extract command (first 200 chars) and exit code
    command_text=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' | head -c 200)
    exit_code=$(printf '%s' "$INPUT" | jq -r '.tool_result.exit_code // 0')

    # Validate exit_code is numeric
    case "$exit_code" in
      ''|*[!0-9]*) exit_code=0 ;;
    esac

    # Append to queue using jq for safe JSON construction
    jq -n \
      --arg type "bash_result" \
      --arg cmd "$command_text" \
      --argjson exit "$exit_code" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{type: $type, command: $cmd, exit_code: $exit, timestamp: $ts}' \
      >> "$QUEUE_FILE" 2>/dev/null || true
    ;;
esac

# Queue rotation: if queue exceeds 10MB, rotate
if [ -f "$QUEUE_FILE" ]; then
  queue_size=$(wc -c < "$QUEUE_FILE" 2>/dev/null || echo 0)
  if [ "$queue_size" -gt 10485760 ]; then
    mv "$QUEUE_FILE" "${QUEUE_FILE}.1" 2>/dev/null || true
    : > "$QUEUE_FILE"
    printf 'Queue rotated at %s bytes\n' "$queue_size" >&2
  fi
fi

printf '{"continue": true}\n'
