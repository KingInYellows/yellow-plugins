#!/usr/bin/env bash
# yellow-core: context-observation reader.
#
# Reads the record lib/context-observer.py writes for a session and reduces
# it to either one compact JSON object or the literal string `unknown`
# (spec R20, plans/specs/session-continuity-foundation.md). It never runs
# git: callers hand it the canonical toplevel (or cwd) they already hold.
#
# Usage:
#   . "${SCRIPT_DIR}/../lib/compound-staging.sh"     # provides cs_iso_to_epoch
#   . "${SCRIPT_DIR}/../lib/context-observer.sh"
#   co_read_observation "$session_id" "$toplevel"    # JSON object or "unknown"
#
# `unknown` is printed when the session id is "unknown" or malformed, the
# record is missing, unreadable, or not a JSON object, its observer_format
# is not 1, its session_id differs, observed_at is malformed or outside the
# staleness window (CO_STALENESS_SECONDS, default 300, either direction), or
# remaining_percentage is null, non-numeric, or outside 0-100. It is never
# rendered as 0.
#
# Sourced library only. MUST NOT set top-level shell options.

[ -n "${_CONTEXT_OBSERVER_LOADED:-}" ] && return 0
_CONTEXT_OBSERVER_LOADED=1

CO_SESSION_ID_RE='^[A-Za-z0-9_-]{1,128}$'
CO_TS_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

co_warn() {
  printf '[context-observer] Warning: %s\n' "$1" >&2
}

# Record path for a session: <config dir>/projects/<slug>/context-observations/<id>.json.
# The slug is the toplevel with "/" -> "-", the same mapping as
# cs_derive_project_slug and the observer's project_slug(). Fails (prints
# nothing) on a malformed id, an empty root, or no resolvable config dir.
#
# Args:
#   $1 — session id (validated against CO_SESSION_ID_RE)
#   $2 — canonical git toplevel, or the cwd outside a repository
co_observation_path() {
  local sid="${1:-}" root="${2:-}" config slug
  [[ "$sid" =~ $CO_SESSION_ID_RE ]] || return 1
  [ -n "$root" ] || return 1
  config="${CLAUDE_CONFIG_DIR:-}"
  if [ -z "$config" ]; then
    [ -n "${HOME:-}" ] || return 1
    config="$HOME/.claude"
  fi
  slug=$(printf '%s' "$root" | tr '/' '-')
  printf '%s/projects/%s/context-observations/%s.json\n' "$config" "$slug" "$sid"
}

# Args:
#   $1 — current session id
#   $2 — canonical git toplevel, or the cwd outside a repository
co_read_observation() {
  local sid="${1:-}" root="${2:-}" file
  if ! command -v cs_iso_to_epoch >/dev/null 2>&1; then
    co_warn "cs_iso_to_epoch is unavailable; source lib/compound-staging.sh before this file"
    printf 'unknown\n'; return 0
  fi
  if [ "$sid" = "unknown" ] || ! file=$(co_observation_path "$sid" "$root"); then
    printf 'unknown\n'; return 0
  fi
  if ! command -v jq >/dev/null 2>&1 || [ ! -f "$file" ] || [ ! -r "$file" ]; then
    printf 'unknown\n'; return 0
  fi

  # One jq pass validates the shape and emits two lines: observed_at (for the
  # staleness check below) and the reduced object. Any shape failure emits
  # nothing, which becomes `unknown`.
  local out="" observed_at="" obj=""
  out=$(jq -rc --arg sid "$sid" '
    if type == "object" and .observer_format == 1 and .session_id == $sid
       and (.observed_at | type) == "string"
       and (.context_window | type) == "object"
       and (.context_window.remaining_percentage | type == "number" and . >= 0 and . <= 100)
    then
      .observed_at,
      {remaining_percentage: .context_window.remaining_percentage,
       used_percentage: (.context_window.used_percentage | if type == "number" then . else null end),
       observed_at: .observed_at,
       advisory_crossings: (.advisory | if type == "object" then .crossings else null end
                            | if type == "number" then . else null end)}
    else empty end' -- "$file" 2>/dev/null) || out=""
  { IFS= read -r observed_at; IFS= read -r obj; } <<< "$out"
  if [ -z "$obj" ] || ! [[ "$observed_at" =~ $CO_TS_RE ]]; then
    printf 'unknown\n'; return 0
  fi

  local window="${CO_STALENESS_SECONDS:-300}" now epoch age
  [[ "$window" =~ ^[0-9]{1,9}$ ]] || window=300
  now=$(date -u +%s) || { printf 'unknown\n'; return 0; }
  epoch=$(cs_iso_to_epoch "$observed_at")
  if ! [[ "$epoch" =~ ^[0-9]+$ ]] || [ "$epoch" -le 0 ]; then
    printf 'unknown\n'; return 0
  fi
  age=$((now - epoch))
  if [ "$age" -gt "$window" ] || [ "$age" -lt "-$window" ]; then
    printf 'unknown\n'; return 0
  fi
  printf '%s\n' "$obj"
}
