#!/bin/bash
# session-start.sh — Initialize ruvector session and load past learnings
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# Receives hook input as JSON on stdin. Must complete within 3 seconds.
# Uses ruvector's built-in CLI hooks — no manual queue management needed.
set -uo pipefail
# Note: -e omitted intentionally — hook must output {"continue": true} on all paths

# --- json_exit: centralized exit for all early-return paths ---
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping session-start"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Resolve ruvector command: require direct binary for SessionStart (3s budget).
# npx resolution alone (~2700ms) consumes nearly the whole budget before any
# of the three CLI calls below run, so skip entirely when the binary is absent.
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
else
  json_exit
fi

# Per-call caps inside the 3s hooks.json watchdog: 0.9s resume + 0.8s per
# recall — a deterministic 2.8s worst case including the three
# --kill-after=0.1 escalations — leaves headroom for jq output. macOS ships
# gtimeout (brew install coreutils); fall back to unwrapped calls if neither
# exists (documented risk, same as user-prompt-submit.sh). Never use
# --foreground here — it stops timeout from killing forked descendants.
# BusyBox's timeout applet (common on Alpine) only supports
# `timeout [-t SECS] [-s SIG] PROG [ARGS]` — no --kill-after flag — and exits
# with a usage error if passed one, which would make every run_budgeted call
# below fail before ruvector ever runs. A non-GNU `timeout` may also sit ahead
# of a working `gtimeout` on PATH, so probe each candidate for GNU-compatible
# --kill-after support and use the first that passes; fall back to the
# unwrapped path only if none do.
TIMEOUT_CMD=""
for _tcmd_name in timeout gtimeout; do
  _tcmd="$(command -v "$_tcmd_name" || true)"
  if [ -n "$_tcmd" ] && "$_tcmd" --kill-after=0.1 0.1 true >/dev/null 2>&1; then
    TIMEOUT_CMD="$_tcmd"
    break
  fi
done
unset _tcmd_name _tcmd

if [ -z "$TIMEOUT_CMD" ]; then
  printf '[ruvector] no GNU-compatible timeout found; session-start CLI calls run without per-call budget enforcement\n' >&2
fi

run_budgeted() {
  local cap="$1"; shift
  if [ -n "$TIMEOUT_CMD" ]; then
    "$TIMEOUT_CMD" --kill-after=0.1 "$cap" "$@"
  else
    "$@"
  fi
}

learnings=""

# --- Priority 1: Run ruvector's built-in session-start hook ---
# This handles queue flushing and session recovery internally.
run_budgeted 0.9 "${RUVECTOR_CMD[@]}" hooks session-start --resume 2>/dev/null || {
  printf '[ruvector] hooks session-start failed or timed out\n' >&2
}

# --- Priority 2: Load top learnings for context ---
recent_learnings=$(run_budgeted 0.8 "${RUVECTOR_CMD[@]}" hooks recall --top-k 3 "recent mistakes and fixes" 2>/dev/null) || {
  printf '[ruvector] Failed to retrieve learnings\n' >&2
  recent_learnings=""
}

skill_learnings=$(run_budgeted 0.8 "${RUVECTOR_CMD[@]}" hooks recall --top-k 2 "useful patterns and techniques" 2>/dev/null) || {
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
