# shell-compat: library
# Shared by reply-pr-thread and resolve-pr-thread (POSIX sh; sourced).
# One GraphQL call helper plus rate-limit and not-found/permission
# classification, so both scripts agree on exit-code meanings.
# shellcheck shell=sh

# Longest rate-limit wait a caller may sleep before its single retry; a longer
# wait exits 4 instead, so the whole call fits the caller's Bash tool timeout
# (120 s by default).
GG_MAX_WAIT_SECONDS=90
# Longest pause gg_pace will sleep after a call.
GG_MAX_PACE_SECONDS=10
# Seconds one gh call may run (YELLOW_REVIEW_GH_TIMEOUT, default 30; invalid
# values fall back to 30). Enforced only when timeout(1) is installed.
GG_TIMEOUT="${YELLOW_REVIEW_GH_TIMEOUT:-30}"
case "$GG_TIMEOUT" in ''|*[!0-9]*) GG_TIMEOUT=30 ;; esac

# gg_init <work-dir>: set the scratch file paths the other helpers read.
gg_init() {
    GG_OUT="$1/out"
    GG_ERR="$1/err"
    GG_HEADERS="$1/headers"
    GG_RESP="$1/body"
}

# gg_call <gh api graphql args...>: run `gh api -i graphql` and split the
# output into $GG_HEADERS and $GG_RESP (output with no status line is all
# body). Sets GG_EXIT and returns it; 124 means timeout(1) killed gh, and the
# mutation may or may not have been applied, so callers must not retry it.
gg_call() {
    : >"$GG_HEADERS"
    : >"$GG_RESP"
    GG_EXIT=0
    if command -v timeout >/dev/null 2>&1; then
        timeout "$GG_TIMEOUT" gh api -i graphql "$@" >"$GG_OUT" 2>"$GG_ERR" || GG_EXIT=$?
    else
        gh api -i graphql "$@" >"$GG_OUT" 2>"$GG_ERR" || GG_EXIT=$?
    fi
    tr -d '\r' <"$GG_OUT" | awk -v h="$GG_HEADERS" -v b="$GG_RESP" '
        NR == 1 { inh = ($0 ~ /^HTTP\//) }
        inh && /^$/ { inh = 0; next }
        inh { print > h; next }
        { print > b }
    '
    return "$GG_EXIT"
}

# gg_header <name>: first value of a response header, case-insensitive.
gg_header() {
    awk -v name="$1" '
        tolower(substr($0, 1, length(name) + 1)) == tolower(name) ":" {
            sub(/^[^:]*:[ \t]*/, ""); print; exit
        }' "$GG_HEADERS"
}

# gg_is_rate_limited: stderr, or a GraphQL error (HTTP 200 with .errors).
# GitHub's secondary (abuse) limits are retryable like the primary one.
gg_is_rate_limited() {
    grep -qiE 'rate limit|abuse|HTTP 429' "$GG_ERR" && return 0
    jq -e '[.errors[]? | (.type // ""), (.message // "")] | any(test("rate limit|abuse|RATE_LIMITED"; "i"))' "$GG_RESP" >/dev/null 2>&1
}

# gg_reason: print "not-found" or "permission" and return 0 when the last
# call failed that way, else print nothing and return 1. Typed GraphQL
# errors win; of the stderr patterns, permission is checked first because a
# 403 body can also say "not found". The patterns are narrow on purpose: a
# bare "not found" or "permission" in a gh message (a missing binary, say)
# is not a thread-level failure.
gg_reason() {
    _gg_type=$(jq -r '[.errors[]? | .type // empty | select(. == "FORBIDDEN" or . == "NOT_FOUND")] | .[0] // empty' "$GG_RESP" 2>/dev/null || :)
    case "$_gg_type" in
        FORBIDDEN) printf 'permission'; return 0 ;;
        NOT_FOUND) printf 'not-found'; return 0 ;;
    esac
    if grep -qiE 'HTTP 403([^0-9]|$)|FORBIDDEN|Resource not accessible' "$GG_ERR"; then
        printf 'permission'; return 0
    fi
    if grep -qiE 'Could not resolve to a|NOT_FOUND|HTTP 404([^0-9]|$)' "$GG_ERR"; then
        printf 'not-found'; return 0
    fi
    return 1
}

# gg_rate_limit_wait: seconds to wait before the single retry (Retry-After,
# then the reset time when no requests remain, then
# YELLOW_REVIEW_RATE_LIMIT_WAIT, default 60). Always prints the computed
# wait; the caller compares it with GG_MAX_WAIT_SECONDS so its exit-4
# message can state the wait it refused.
gg_rate_limit_wait() {
    _gg_wait=$(gg_header retry-after)
    case "$_gg_wait" in ''|*[!0-9]*) _gg_wait="" ;; esac
    if [ -z "$_gg_wait" ] && [ "$(gg_header x-ratelimit-remaining)" = 0 ]; then
        _gg_reset=$(gg_header x-ratelimit-reset)
        case "$_gg_reset" in
            ''|*[!0-9]*) ;;
            *) _gg_wait=$((_gg_reset - $(date +%s))); [ "$_gg_wait" -ge 0 ] || _gg_wait=0 ;;
        esac
    fi
    if [ -z "$_gg_wait" ]; then
        _gg_wait="${YELLOW_REVIEW_RATE_LIMIT_WAIT:-60}"
        case "$_gg_wait" in ''|*[!0-9]*) _gg_wait=60 ;; esac
    fi
    printf '%s' "$_gg_wait"
}

# gg_pace: sleep YELLOW_REVIEW_PACE_SECONDS (default 1, invalid -> 1, capped
# at GG_MAX_PACE_SECONDS) so a bad value cannot fail a finished mutation.
gg_pace() {
    _gg_pace="${YELLOW_REVIEW_PACE_SECONDS:-1}"
    case "$_gg_pace" in ''|*[!0-9]*) _gg_pace=1 ;; esac
    [ "${#_gg_pace}" -le 4 ] && [ "$_gg_pace" -le "$GG_MAX_PACE_SECONDS" ] || _gg_pace=$GG_MAX_PACE_SECONDS
    sleep "$_gg_pace"
}
