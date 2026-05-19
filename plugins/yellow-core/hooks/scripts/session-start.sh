#!/usr/bin/env bash
# session-start.sh — yellow-core SessionStart hook: drain dispatcher for the
# background compounding pipeline.
#
# Reads pending/ in the per-project staging dir; if thresholds are met,
# spawns a disowned `claude -p` drain subshell (env-var-guarded against
# recursion) that processes pending entries asynchronously. Returns
# {"continue": true} within the 3s hook timeout.
#
# Note: -e omitted intentionally — hook must output {"continue": true} on
# all paths. With -e, any unexpected non-zero would exit before JSON is
# printed, blocking session startup.
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
# Drain `claude -p` sessions inherit this env var; their SessionStart hook
# fires too and would otherwise fire a nested drain.
if [ "${COMPOUND_DRAIN_IN_PROGRESS:-}" = "1" ]; then
  json_exit
fi

# --- jq dependency ---
if ! command -v jq >/dev/null 2>&1; then
  json_exit "jq not installed; cannot evaluate drain thresholds"
fi

# --- Parse stdin ---
INPUT=$(cat)
CWD=""
if [ -n "$INPUT" ]; then
  # shellcheck disable=SC2154
  eval "$(printf '%s' "$INPUT" | jq -r '@sh "CWD=\(.cwd // "")"' 2>/dev/null)" \
    || CWD=""
fi
if [ -z "$CWD" ]; then
  if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
    printf '[yellow-core] compound-staging: Warning: CLAUDE_PROJECT_DIR unset; falling back to PWD (%s)\n' "$PWD" >&2
  fi
  CWD="${CLAUDE_PROJECT_DIR:-$PWD}"
fi

PROJECT_SLUG=$(cs_derive_project_slug "$CWD")
if [ -z "$PROJECT_SLUG" ]; then
  json_exit
fi
STAGING_DIR=$(cs_staging_dir_for_slug "$PROJECT_SLUG")

# First-run fast-exit: if pending/ doesn't exist yet, there's nothing to
# drain and nothing to reap.
if [ ! -d "${STAGING_DIR}/pending" ]; then
  json_exit
fi

# --- Reaper (defense against undrained data) ---
# Each find runs independently so one failure doesn't suppress the others.
# Errors are non-fatal — log to stderr only.

# Orphan tmp/*.jsonl > 1h: leftover from crashed atomic writes.
find "${STAGING_DIR}/tmp" -name '*.jsonl.tmp.*' -mmin +60 -delete 2>/dev/null \
  || true

# Stale .drain-lock: dir-style lock. If mtime > 30 min, previous drain
# crashed without releasing — reap so a fresh drain can fire.
#
# Edge case: .drain-lock as a regular file (created by accident or by
# a non-yellow-core process). mkdir would always fail (EEXIST) and
# rmdir cannot remove non-directories — without explicit handling we
# would deadlock drain dispatch permanently. Remove the file first.
if [ -f "${STAGING_DIR}/.drain-lock" ]; then
  printf '[yellow-core] compound-staging: removing non-directory .drain-lock (deadlock recovery)\n' >&2
  rm -f -- "${STAGING_DIR}/.drain-lock" 2>/dev/null \
    || printf '[yellow-core] compound-staging: non-dir lock rm failed\n' >&2
fi
if [ -d "${STAGING_DIR}/.drain-lock" ]; then
  # Default lock_age_min to -1 (skip reap) when stat fails for any reason
  # other than missing file. Defaulting to 999 (treat as stale) would
  # blow away a live lock owned by another concurrent drain whenever
  # stat returned non-zero for a reason other than absence.
  lock_age_min=-1
  if lock_mtime=$(stat -c '%Y' "${STAGING_DIR}/.drain-lock" 2>/dev/null \
    || stat -f '%m' "${STAGING_DIR}/.drain-lock" 2>/dev/null); then
    now_epoch=$(date +%s)
    lock_age_min=$(( (now_epoch - lock_mtime) / 60 ))
  else
    printf '[yellow-core] compound-staging: Warning: stat failed on .drain-lock; skipping stale-lock reap this cycle\n' >&2
  fi
  if [ "$lock_age_min" -gt 30 ] 2>/dev/null; then
    rmdir "${STAGING_DIR}/.drain-lock" 2>/dev/null \
      || printf '[yellow-core] compound-staging: stale lock rmdir failed\n' >&2
  fi
fi

# PII TTL: delete pending/*.jsonl older than 7 days. Log when reaping so
# the user sees that undrained PII was purged.
expired_count=$(find "${STAGING_DIR}/pending" -name '*.jsonl' -mtime +7 \
  -print 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "${expired_count:-0}" -gt 0 ] 2>/dev/null; then
  printf '[yellow-core] compound-staging: reaping %s pending entries older than 7 days\n' \
    "$expired_count" >&2
  find "${STAGING_DIR}/pending" -name '*.jsonl' -mtime +7 -delete 2>/dev/null \
    || true
fi

# Processing/ entries older than 1h are crashed mid-drain; move them back
# to pending/ so they get retried. Younger files are in-flight from a
# concurrent drain — leave them alone.
if [ -d "${STAGING_DIR}/processing" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    base=$(basename -- "$f")
    mv -- "$f" "${STAGING_DIR}/pending/${base}" 2>/dev/null \
      || printf '[yellow-core] compound-staging: failed to requeue crashed entry %s\n' "$base" >&2
  done < <(find "${STAGING_DIR}/processing" -name '*.jsonl' -mmin +60 -print 2>/dev/null)
fi

# --- Threshold check ---
# count >= 5 OR oldest_age > 48h (Max 20x responsive defaults per plan §Budget Model).
PENDING_COUNT=$(find "${STAGING_DIR}/pending" -maxdepth 1 -name '*.jsonl' -type f 2>/dev/null \
  | wc -l | tr -d '[:space:]')
PENDING_COUNT="${PENDING_COUNT:-0}"

if [ "$PENDING_COUNT" -eq 0 ] 2>/dev/null; then
  json_exit
fi

DISPATCH=0
if [ "$PENDING_COUNT" -ge 5 ] 2>/dev/null; then
  DISPATCH=1
else
  # Check oldest mtime. Linux stat first, BSD/macOS stat second.
  oldest_epoch=""
  oldest_file=$(find "${STAGING_DIR}/pending" -maxdepth 1 -name '*.jsonl' -type f \
    -printf '%T@ %p\n' 2>/dev/null | sort -n | head -1 | awk '{print $2}')
  if [ -z "$oldest_file" ]; then
    # BSD find doesn't support -printf. Fall back to stat per-file.
    oldest_epoch=$(find "${STAGING_DIR}/pending" -maxdepth 1 -name '*.jsonl' -type f \
      -exec stat -f '%m' {} \; 2>/dev/null | sort -n | head -1)
  else
    oldest_epoch=$(stat -c '%Y' "$oldest_file" 2>/dev/null) || oldest_epoch=""
  fi
  # Guard against epoch-0 (stat failure) or non-numeric output that
  # would compute a huge fake age and trigger drain on every session
  # forever. Only dispatch when we have a positive epoch.
  if [ -n "$oldest_epoch" ] && [ "$oldest_epoch" -gt 0 ] 2>/dev/null; then
    now_epoch=$(date +%s)
    age_hours=$(( (now_epoch - oldest_epoch) / 3600 ))
    if [ "$age_hours" -gt 48 ] 2>/dev/null; then
      DISPATCH=1
    fi
  fi
fi

if [ "$DISPATCH" -eq 0 ]; then
  json_exit
fi

# --- Acquire drain lock (atomic mkdir) ---
if ! mkdir "${STAGING_DIR}/.drain-lock" 2>/dev/null; then
  # Concurrent drain already in flight (or stale lock not yet reaped).
  json_exit
fi

# --- Resolve claude binary ---
# Allow tests to override via COMPOUND_DRAIN_CMD env var, but ONLY
# inside a bats test process (bats exports BATS_VERSION to every test
# subprocess). Without this gate, the override would be a
# production-available drain-hijack vector — anyone who can set the
# env var before Claude Code starts could redirect the drain to an
# arbitrary binary running with bypassPermissions.
CLAUDE_BIN=""
if [ -n "${COMPOUND_DRAIN_CMD:-}" ] && [ -n "${BATS_VERSION:-}" ]; then
  CLAUDE_BIN="$COMPOUND_DRAIN_CMD"
fi
if [ -z "$CLAUDE_BIN" ]; then
  CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  rmdir "${STAGING_DIR}/.drain-lock" 2>/dev/null || true
  json_exit "claude binary not found; skipping drain"
fi

# --- Build drain prompt ---
# Heredoc with single-quoted delimiter so $STAGING_DIR etc. are NOT
# interpreted here — values are substituted via the inline expansion in
# the printf format.
DRAIN_PROMPT=$(printf '%s\n' \
  'Invoke the staging-reviewer agent (yellow-core:workflow:staging-reviewer) via Task.' \
  '' \
  'Goal: drain the compound-staging ledger and promote eligible entries.' \
  '' \
  "Staging dir: ${STAGING_DIR}" \
  "Project: ${CWD}" \
  '' \
  'Do NOT ask the user any questions. This drain is non-interactive.' \
  'On completion, write a one-line summary to stdout and exit.')

# --- Spawn disowned drain subshell ---
mkdir -p -- "${STAGING_DIR}/drain-logs" 2>/dev/null || true
DRAIN_LOG="${STAGING_DIR}/drain-logs/$(date +%Y%m%d-%H%M%S).log"
AUTH_ROUTE=$(cs_detect_auth_route)

(
  trap 'rmdir "'"${STAGING_DIR}"'/.drain-lock" 2>/dev/null || true' EXIT INT TERM
  export COMPOUND_DRAIN_IN_PROGRESS=1
  printf '[yellow-core] compound-staging: drain dispatch %s (auth=%s, pending=%s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$AUTH_ROUTE" "$PENDING_COUNT" >> "$DRAIN_LOG" 2>/dev/null
  "$CLAUDE_BIN" -p "$DRAIN_PROMPT" \
    --max-turns 50 \
    --permission-mode bypassPermissions \
    --output-format json \
    >> "$DRAIN_LOG" 2>&1
  cs_update_drain_budget "$STAGING_DIR" "$AUTH_ROUTE" || true
) >/dev/null 2>&1 &
disown

json_exit
