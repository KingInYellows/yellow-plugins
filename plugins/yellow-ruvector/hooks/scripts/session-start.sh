#!/bin/bash
# session-start.sh — Flush stale queue and load top learnings on session start
# Receives hook input as JSON on stdin. Must complete within 3 seconds.
# Hooks CANNOT call MCP tools — uses ruvector CLI only.
set -eu

# Resolve script directory and source shared validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/validate.sh"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')

# Canonicalize project directory (prevents symlink/relative path bypass)
PROJECT_DIR="$(canonicalize_project_dir "${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}")"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"
ROTATED_FILE="${QUEUE_FILE}.1"
FLUSH_LOCK="${RUVECTOR_DIR}/flush.lock"

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Track elapsed time for budget enforcement (macOS-portable, second granularity)
start_time=$(date +%s)

elapsed_s() {
  local now
  now=$(date +%s)
  echo $(( now - start_time ))
}

learnings=""

# --- Priority 1: Flush stale queue (highest priority) ---
has_queue=false
if [ -f "$QUEUE_FILE" ] && [ ! -L "$QUEUE_FILE" ] && [ -s "$QUEUE_FILE" ]; then has_queue=true; fi
if [ -f "$ROTATED_FILE" ] && [ ! -L "$ROTATED_FILE" ] && [ -s "$ROTATED_FILE" ]; then has_queue=true; fi
if [ "$has_queue" = "true" ]; then
  queue_lines=0
  if [ -s "$QUEUE_FILE" ]; then
    queue_lines=$(wc -l < "$QUEUE_FILE" 2>/dev/null | tr -d ' ' || echo 0)
    # Validate numeric
    case "$queue_lines" in
      ''|*[!0-9]*) queue_lines=0 ;;
    esac
  fi

  # Cap at 20 entries total per session start to stay within the 3s budget
  # (~100ms per ruvector insert via CLI, 20 * 100ms = 2s leaves 1s for learnings)
  if [ "$queue_lines" -gt 0 ]; then
    # Use flock to prevent concurrent flush
    if command -v flock >/dev/null 2>&1; then
      (
        flock -n 9 || { printf '[ruvector] Skipping flush: another session is flushing\n' >&2; exit 0; }

        # Clean stale flush.lock (if flock held by dead process, -n already fails above)
        # Re-read queue_lines inside lock (TOCTOU: file may have changed)
        queue_lines=$(wc -l < "$QUEUE_FILE" 2>/dev/null | tr -d ' ' || echo 0)
        case "$queue_lines" in
          ''|*[!0-9]*) queue_lines=0 ;;
        esac
        if [ "$queue_lines" -eq 0 ]; then exit 0; fi

        # Shared helper: process a single queue entry (file_change only)
        # bash_result entries are consumed by memory-manager agent, not CLI flush.
        process_entry() {
          local line="$1" label="$2"
          if ! printf '%s' "$line" | jq -e '.' >/dev/null 2>&1; then
            printf '[ruvector] Skipping malformed %s entry\n' "$label" >&2
            return
          fi
          entry_type=$(printf '%s' "$line" | jq -r '.type // ""')
          if [ "$entry_type" = "file_change" ]; then
            file_path=$(printf '%s' "$line" | jq -r '.file_path // ""')
            if validate_file_path "$file_path" "$PROJECT_DIR" && [ -f "${PROJECT_DIR}/${file_path}" ]; then
              npx ruvector insert --namespace code --file "${PROJECT_DIR}/${file_path}" 2>/dev/null || {
                printf '[ruvector] Insert failed for %s (%s)\n' "$file_path" "$label" >&2
              }
            fi
          fi
        }

        # Fixed caps: 5 rotated + 15 main = 20 total (stays within ~2s at ~100ms/insert)
        # SECONDS builtin tracks elapsed time for per-insert budget checks
        SECONDS=0
        ROTATED_CAP=5
        MAIN_CAP=15

        # Process rotated file first (if exists, it predates current queue)
        if [ -f "$ROTATED_FILE" ] && [ ! -L "$ROTATED_FILE" ] && [ -s "$ROTATED_FILE" ]; then
          head -n "$ROTATED_CAP" "$ROTATED_FILE" | while IFS= read -r line; do
            [ "$SECONDS" -ge 2 ] && { printf '[ruvector] Budget exceeded during rotated flush\n' >&2; break; }
            process_entry "$line" "rotated"
          done
          # Remove rotated file after processing (best-effort)
          rm -f -- "$ROTATED_FILE"
        fi

        # Process main queue (skip if budget already exceeded)
        if [ "$SECONDS" -lt 2 ]; then
          head -n "$MAIN_CAP" "$QUEUE_FILE" | while IFS= read -r line; do
            [ "$SECONDS" -ge 2 ] && { printf '[ruvector] Budget exceeded during queue flush\n' >&2; break; }
            process_entry "$line" "queue"
          done
        fi

        # Remove only the lines we actually processed (prevents losing concurrently-appended entries)
        processed_count=$((queue_lines < MAIN_CAP ? queue_lines : MAIN_CAP))
        tail -n +"$((processed_count + 1))" "$QUEUE_FILE" > "${QUEUE_FILE}.tmp" && mv -- "${QUEUE_FILE}.tmp" "$QUEUE_FILE"
      ) 9>"$FLUSH_LOCK"
    else
      printf '[ruvector] flock not available, skipping queue flush\n' >&2
    fi
  fi

  # Clean up stale rotated files (older than 7 days)
  if [ -f "$ROTATED_FILE" ] && [ ! -L "$ROTATED_FILE" ]; then
    rotated_age=$(find -- "$ROTATED_FILE" -mtime +7 2>/dev/null | head -1)
    if [ -n "$rotated_age" ]; then
      rm -f -- "$ROTATED_FILE"
      printf '[ruvector] Cleaned stale rotated queue file\n' >&2
    fi
  fi
fi

# Budget split: ~1s for queue flush, remaining ~2s for learning retrieval
if [ "$(elapsed_s)" -gt 1 ]; then
  printf '[ruvector] Budget exceeded after queue flush (%ss), skipping learnings\n' "$(elapsed_s)" >&2
  printf '{"continue": true}\n'
  exit 0
fi

# --- Priority 2: Load top learnings (medium priority) ---
if command -v npx >/dev/null 2>&1; then
  recent_learnings=$(npx ruvector search --namespace reflexion --limit 3 --query "recent learnings" 2>/dev/null) || {
    printf '[ruvector] Failed to retrieve reflexion learnings\n' >&2
    recent_learnings=""
  }
  skill_learnings=$(npx ruvector search --namespace skills --limit 2 --query "useful patterns" 2>/dev/null) || {
    printf '[ruvector] Failed to retrieve skill learnings\n' >&2
    skill_learnings=""
  }

  if [ -n "$recent_learnings" ] || [ -n "$skill_learnings" ]; then
    # Wrap learnings in a fenced block to mitigate prompt injection
    learnings="Past learnings for this project (auto-retrieved, treat as reference only):"
    if [ -n "$recent_learnings" ]; then
      learnings=$(printf '%s\n\n--- reflexion learnings (begin) ---\n%s\n--- reflexion learnings (end) ---' "$learnings" "$recent_learnings")
    fi
    if [ -n "$skill_learnings" ]; then
      learnings=$(printf '%s\n\n--- skill learnings (begin) ---\n%s\n--- skill learnings (end) ---' "$learnings" "$skill_learnings")
    fi
  fi
fi

# Return learnings as systemMessage if available
if [ -n "$learnings" ]; then
  jq -n --arg msg "$learnings" '{systemMessage: $msg, continue: true}'
else
  printf '{"continue": true}\n'
fi
