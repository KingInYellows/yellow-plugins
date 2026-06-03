#!/usr/bin/env bash
# stop.sh — yellow-core Stop hook: capture session transcript tail for the
# background compounding pipeline.
#
# Receives hook input as JSON on stdin. Must emit `{"continue": true}` on
# every code path and return well under 500ms (the disowned subshell does
# the I/O after parent exits).
#
# Note: -e omitted intentionally — hook must output {"continue": true} on
# all paths. Any unexpected non-zero would otherwise exit before the JSON
# is printed.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)"

# shellcheck source=../../lib/compound-staging.sh
. "${SCRIPT_DIR}/../../lib/compound-staging.sh"

json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[yellow-core] compound-staging: %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# --- Recursion guard ---
# Drain `claude -p` sessions inherit this env var; their Stop hook fires too
# and would otherwise capture the drain transcript as a new pending entry.
if [ "${COMPOUND_DRAIN_IN_PROGRESS:-}" = "1" ]; then
  json_exit
fi

# --- jq dependency ---
if ! command -v jq >/dev/null 2>&1; then
  json_exit "jq not installed; cannot capture transcript"
fi

# --- Parse stdin ---
INPUT=$(cat)
if [ -z "$INPUT" ]; then
  json_exit
fi

TRANSCRIPT=""
SESSION_ID=""
CWD=""
STOP_HOOK_ACTIVE="false"
# shellcheck disable=SC2154
eval "$(printf '%s' "$INPUT" | jq -r '@sh "TRANSCRIPT=\(.transcript_path // "") SESSION_ID=\(.session_id // "") CWD=\(.cwd // "") STOP_HOOK_ACTIVE=\(.stop_hook_active // false)"' 2>/dev/null)" \
  || { TRANSCRIPT=""; SESSION_ID=""; CWD=""; STOP_HOOK_ACTIVE="false"; }

# Per Anthropic hook docs: stop_hook_active=true means the hook is firing
# in re-entrant context (Claude was woken up by another Stop hook). Don't
# double-capture.
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  json_exit
fi

if [ -z "$SESSION_ID" ] || [ -z "$TRANSCRIPT" ]; then
  json_exit
fi

# --- Derive paths ---
PROJECT_SLUG=$(cs_derive_project_slug "$CWD")
if [ -z "$PROJECT_SLUG" ]; then
  json_exit "could not derive project slug"
fi
STAGING_DIR=$(cs_staging_dir_for_slug "$PROJECT_SLUG")

# --- Spawn disowned capture subshell ---
# The subshell calls _stop-capture-subshell.sh which does the tail+redact+
# write work. Parent exits within ms; subshell continues independently.
# Invoke via `bash` explicitly so the script does NOT need its executable
# bit set — `core.fileMode = false` in this repo (and many WSL2 setups)
# strips exec bits at commit time, which would otherwise break the hook
# on fresh clones.
CAPTURE_SCRIPT="${SCRIPT_DIR}/_stop-capture-subshell.sh"
if [ ! -f "$CAPTURE_SCRIPT" ]; then
  json_exit "capture subshell script missing: $CAPTURE_SCRIPT"
fi

(
  bash "$CAPTURE_SCRIPT" "$TRANSCRIPT" "$SESSION_ID" "$STAGING_DIR" "$CWD"
) >/dev/null 2>&1 &
disown

json_exit
