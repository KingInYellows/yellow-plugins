#!/bin/bash
# session-start.sh — Flush stale queue and load top learnings on session start
# Receives hook input as JSON on stdin. Must complete within 3 seconds.
# Hooks CANNOT call MCP tools — uses ruvector CLI only.
set -eu

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""')

# If no CWD from hook input, use CLAUDE_PROJECT_DIR or PWD
PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"
QUEUE_FILE="${RUVECTOR_DIR}/pending-updates.jsonl"
ROTATED_FILE="${QUEUE_FILE}.1"

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  printf '{"continue": true}\n'
  exit 0
fi

# Track elapsed time for budget enforcement
start_time=$(date +%s%N 2>/dev/null || date +%s)

elapsed_ms() {
  local now
  now=$(date +%s%N 2>/dev/null || date +%s)
  if [ ${#now} -gt 10 ]; then
    # nanosecond precision available
    echo $(( (now - start_time) / 1000000 ))
  else
    # second precision fallback
    echo $(( (now - start_time) * 1000 ))
  fi
}

learnings=""

# --- Priority 1: Flush stale queue (highest priority) ---
has_queue=false
if [ -s "$QUEUE_FILE" ]; then has_queue=true; fi
if [ -f "$ROTATED_FILE" ] && [ -s "$ROTATED_FILE" ]; then has_queue=true; fi
if "$has_queue"; then
  queue_lines=0
  if [ -s "$QUEUE_FILE" ]; then
    queue_lines=$(wc -l < "$QUEUE_FILE")
  fi

  # Cap at 20 entries to stay within budget
  if [ "$queue_lines" -gt 0 ]; then
    # Use flock to prevent concurrent flush
    if command -v flock >/dev/null 2>&1; then
      (
        flock -n 9 || { printf 'Skipping flush: another session is flushing\n' >&2; exit 0; }
        # Process queue via ruvector CLI (NOT MCP)
        head -n 20 "$QUEUE_FILE" | while IFS= read -r line; do
          # Validate JSON before processing
          if ! printf '%s' "$line" | jq -e '.' >/dev/null 2>&1; then
            printf 'Skipping malformed queue entry\n' >&2
            continue
          fi
          entry_type=$(printf '%s' "$line" | jq -r '.type // ""')
          if [ "$entry_type" = "file_change" ]; then
            file_path=$(printf '%s' "$line" | jq -r '.file_path // ""')
            if [ -n "$file_path" ] && [ -f "${PROJECT_DIR}/${file_path}" ]; then
              npx ruvector insert --namespace code --file "${PROJECT_DIR}/${file_path}" 2>/dev/null || true
            fi
          fi
        done
        # Remove processed lines (keep remaining)
        if [ "$queue_lines" -le 20 ]; then
          : > "$QUEUE_FILE"
        else
          tail -n +"21" "$QUEUE_FILE" > "${QUEUE_FILE}.tmp" && mv "${QUEUE_FILE}.tmp" "$QUEUE_FILE"
        fi
      ) 9>"${RUVECTOR_DIR}/flush.lock"
    fi
  fi

  # Clean up stale rotated files (older than 7 days)
  if [ -f "$ROTATED_FILE" ]; then
    rotated_age=$(find "$ROTATED_FILE" -mtime +7 2>/dev/null | head -1)
    if [ -n "$rotated_age" ]; then
      rm -f "$ROTATED_FILE"
      printf 'Cleaned stale rotated queue file\n' >&2
    fi
  fi
fi

# Check budget after flush
if [ "$(elapsed_ms)" -gt 1500 ]; then
  printf 'Budget exceeded after queue flush (%sms), skipping learnings\n' "$(elapsed_ms)" >&2
  printf '{"continue": true}\n'
  exit 0
fi

# --- Priority 2: Load top 5 learnings (medium priority) ---
if command -v npx >/dev/null 2>&1; then
  # Search for recent learnings via CLI
  recent_learnings=$(npx ruvector search --namespace reflexion --limit 3 --query "recent learnings" 2>/dev/null || true)
  skill_learnings=$(npx ruvector search --namespace skills --limit 2 --query "useful patterns" 2>/dev/null || true)

  if [ -n "$recent_learnings" ] || [ -n "$skill_learnings" ]; then
    learnings="Past learnings for this project:"
    if [ -n "$recent_learnings" ]; then
      learnings="${learnings}\n\nReflexions:\n${recent_learnings}"
    fi
    if [ -n "$skill_learnings" ]; then
      learnings="${learnings}\n\nSkills:\n${skill_learnings}"
    fi
  fi
fi

# --- Priority 3: Incremental index (lowest priority, skip if over budget) ---
if [ "$(elapsed_ms)" -gt 2000 ]; then
  printf 'Budget exceeded (%sms), skipping incremental index\n' "$(elapsed_ms)" >&2
else
  # Incremental index is deferred to /ruvector:index command
  # SessionStart only handles queue flush and learning retrieval
  :
fi

# Return learnings as systemMessage if available
if [ -n "$learnings" ]; then
  # Use jq to safely construct JSON output
  jq -n --arg msg "$learnings" '{systemMessage: $msg, continue: true}'
else
  printf '{"continue": true}\n'
fi
