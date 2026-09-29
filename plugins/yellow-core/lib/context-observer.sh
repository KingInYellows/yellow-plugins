#!/usr/bin/env bash
# yellow-core: context-observation reader.
#
# Reads the record lib/context-observer.py writes for a session and reduces
# it to either one compact JSON object or the literal string `unknown`
# (spec R20, plans/specs/session-continuity-foundation.md). It never runs
# git and never needs the session's working directory.
#
# Usage:
#   . "${SCRIPT_DIR}/../lib/compound-staging.sh"     # provides cs_iso_to_epoch
#   . "${SCRIPT_DIR}/../lib/context-observer.sh"
#   co_read_observation "$session_id"                # JSON object or "unknown"
#
# The record is the newest one for the session id across every project
# directory: the observer keys it by the session's launch directory, which
# differs from the toplevel when a session works in a linked worktree, a
# repository subdirectory, or through a symlink, and a resumed session can leave
# records under more than one directory.
#
# `unknown` is printed when the session id is "unknown" or malformed, no
# record exists for it, the record is unreadable or not a JSON object, its
# observer_format is not 1, its session_id differs, observed_at is malformed
# or more than CO_STALE_AFTER seconds away from now in either direction, or
# remaining_percentage is null, non-numeric, or outside 0-100. It is never
# rendered as 0. Why it was unknown is a stable reason code: written to the
# file named by CO_REASON_FILE when that variable is set (handoff.sh context
# uses this), and printed on stderr with CONTEXT_OBSERVER_DEBUG=1. Codes:
#   helper-missing, no-session-id, malformed-session-id, jq-missing, jq-failed,
#   no-record, record-unreadable, record-malformed, format-mismatch,
#   other-session, no-percentage, out-of-range, observed-at-unparseable,
#   clock-unavailable, stale.
# format-mismatch usually means an installed observer copy older or newer than
# the plugin: re-run /statusline:setup observer. stale (and no-record) is also
# what an enabled observer that can no longer write looks like: the writer is
# silent unless CONTEXT_OBSERVER_DEBUG=1 is set in the statusline's
# environment, which makes it say why on stderr.
#
# Keep in sync with lib/context-observer.py: SESSION_ID_RE, config_dir() and
# the CLAUDE_CONFIG_DIR / HOME rules below are the same rules written twice
# (tests/context-observer.bats checks the pair against each other).
#
# Sourced library only. MUST NOT set top-level shell options.

[ -n "${_CONTEXT_OBSERVER_LOADED:-}" ] && return 0
_CONTEXT_OBSERVER_LOADED=1

CO_SESSION_ID_RE='^[A-Za-z0-9_-]{1,128}$'
CO_STALE_AFTER=300

# jq definition shared with handoff.sh: validates a reduced context object
# and returns it rebuilt from its six known fields, or the string "unknown".
# observed_at is anchored with \A…\z because Oniguruma's $ also matches
# before a trailing newline. The optional fields are nulled when out of the
# range the observer can write: used_percentage 0-100, advisory_crossings a
# non-negative integer, watermark_remaining 1-99.
# shellcheck disable=SC2016
CO_CONTEXT_JQ='def co_context:
  if type == "object"
     and (.remaining_percentage | type == "number" and . >= 0 and . <= 100)
     and (.observed_at | type == "string"
          and test("\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\\z"))
  then {remaining_percentage,
        used_percentage: (.used_percentage
          | if type == "number" and . >= 0 and . <= 100 then . else null end),
        observed_at,
        advisory_crossings: (.advisory_crossings
          | if type == "number" and . >= 0 and . == floor then . else null end),
        advisory_state: (.advisory_state | if . == "above" or . == "below" then . else null end),
        watermark_remaining: (.watermark_remaining
          | if type == "number" and . >= 1 and . <= 99 then . else null end)}
  else "unknown" end;'

co_warn() {
  printf '[context-observer] Warning: %s\n' "$1" >&2
}

# Print `unknown`, record the reason code (CO_REASON_FILE), and say why on
# stderr when CONTEXT_OBSERVER_DEBUG=1.
#
# Args:
#   $1 — reason code (see the header)
#   $2 — human-readable detail for the debug line
co_unknown() {
  if [ -n "${CO_REASON_FILE:-}" ]; then
    printf '%s\n' "$1" > "$CO_REASON_FILE" 2>/dev/null || true
  fi
  if [ "${CONTEXT_OBSERVER_DEBUG:-}" = "1" ]; then
    printf '[context-observer] unknown: %s (%s)\n' "$1" "${2:-$1}" >&2
  fi
  printf 'unknown\n'
}

co_config_dir() {
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$CLAUDE_CONFIG_DIR"
  elif [ -n "${HOME:-}" ]; then
    printf '%s/.claude\n' "$HOME"
  else
    return 1
  fi
}

# The record for a session: the newest
# <config>/projects/*/context-observations/<id>.json. Fails (prints nothing)
# on a malformed id, no resolvable config dir, or no record.
#
# Args:
#   $1 — session id (validated against CO_SESSION_ID_RE)
co_find_record() {
  local sid="${1:-}" config candidate newest=""
  [[ "$sid" =~ $CO_SESSION_ID_RE ]] || return 1
  config=$(co_config_dir) || return 1
  for candidate in "$config"/projects/*/context-observations/"$sid".json; do
    [ -f "$candidate" ] || continue
    if [ -z "$newest" ] || [ "$candidate" -nt "$newest" ]; then newest="$candidate"; fi
  done
  [ -n "$newest" ] || return 1
  printf '%s\n' "$newest"
}

# Why a record that failed co_context is unusable: one reason code.
#
# Args: $1 — session id, $2 — record file
co_classify_record() {
  local class
  class=$(jq -r --arg sid "$1" '
    if type != "object" then "record-malformed"
    elif .observer_format != 1 then "format-mismatch"
    elif .session_id != $sid then "other-session"
    elif (.context_window | type) != "object" then "record-malformed"
    elif (.context_window.remaining_percentage | type) == "null" then "no-percentage"
    elif (.context_window.remaining_percentage | type) != "number" then "record-malformed"
    elif .context_window.remaining_percentage < 0 or .context_window.remaining_percentage > 100 then "out-of-range"
    else "record-malformed" end' -- "$2" 2>/dev/null) || class=record-malformed
  printf '%s\n' "${class:-record-malformed}"
}

# Args:
#   $1 — current session id
co_read_observation() {
  local sid="${1:-}" file
  if ! command -v cs_iso_to_epoch >/dev/null 2>&1; then
    co_warn "cs_iso_to_epoch is unavailable; source lib/compound-staging.sh before this file"
    co_unknown helper-missing "cs_iso_to_epoch missing"; return 0
  fi
  if [ "$sid" = "unknown" ]; then co_unknown no-session-id "no session id"; return 0; fi
  if ! [[ "$sid" =~ $CO_SESSION_ID_RE ]]; then co_unknown malformed-session-id "malformed session id"; return 0; fi
  if ! command -v jq >/dev/null 2>&1; then co_unknown jq-missing "jq missing"; return 0; fi
  if ! file=$(co_find_record "$sid"); then co_unknown no-record "no record for this session"; return 0; fi
  if [ ! -r "$file" ]; then co_unknown record-unreadable "record unreadable"; return 0; fi

  # One jq pass validates the record, reduces it through co_context, and
  # emits two lines: observed_at (for the staleness check below) and the
  # reduced object. co_context anchors observed_at, so it cannot carry a
  # newline. A record that fails validation emits nothing (exit 0); a jq
  # crash is a non-zero exit.
  local out="" observed_at="" obj="" jq_status=0
  out=$(jq -rc --arg sid "$sid" "$CO_CONTEXT_JQ"'
    if type == "object" and .observer_format == 1 and .session_id == $sid
       and (.context_window | type) == "object"
    then
      {remaining_percentage: .context_window.remaining_percentage,
       used_percentage: .context_window.used_percentage,
       observed_at,
       advisory_crossings: (.advisory | if type == "object" then .crossings else null end),
       advisory_state: (.advisory | if type == "object" then .last_state else null end),
       watermark_remaining: (.advisory | if type == "object" then .watermark_remaining else null end)}
      | co_context
      | if type == "object" then .observed_at, . else empty end
    else empty end' -- "$file" 2>/dev/null); jq_status=$?
  if [ "$jq_status" -ne 0 ]; then
    # A record that is not JSON at all makes jq exit non-zero too.
    if jq -e . -- "$file" >/dev/null 2>&1; then
      co_unknown jq-failed "jq failed (exit $jq_status)"
    else
      co_unknown record-malformed "record is not valid JSON"
    fi
    return 0
  fi
  { IFS= read -r observed_at; IFS= read -r obj; } <<< "$out"
  if [ -z "$obj" ]; then
    local reason
    reason=$(co_classify_record "$sid" "$file")
    co_unknown "$reason" "record unusable: $reason"; return 0
  fi

  local now epoch age
  now=$(date -u +%s) || { co_unknown clock-unavailable "clock unavailable"; return 0; }
  epoch=$(cs_iso_to_epoch "$observed_at")
  if ! [[ "$epoch" =~ ^[0-9]+$ ]] || [ "$epoch" -le 0 ]; then
    co_unknown observed-at-unparseable "observed_at unparseable"; return 0
  fi
  age=$((now - epoch))
  if [ "$age" -gt "$CO_STALE_AFTER" ] || [ "$age" -lt "-$CO_STALE_AFTER" ]; then
    co_unknown stale "${age}s old, window ${CO_STALE_AFTER}s"; return 0
  fi
  printf '%s\n' "$obj"
}
