# shell-compat: library
# Shared by file-followup-issue and get-pr-blockers (POSIX sh; sourced).
# A gh call that hangs must not hold the caller's Bash tool call open, so
# every gh call here runs under timeout(1) when it is installed.
# shellcheck shell=sh

# Seconds per gh call (YELLOW_REVIEW_GH_TIMEOUT, default 30, as in
# reply-pr-thread). timeout(1) treats 0 as "no limit", so 0 or a non-number
# falls back to the default.
RG_GH_TIMEOUT="${YELLOW_REVIEW_GH_TIMEOUT:-30}"
case "$RG_GH_TIMEOUT" in ''|*[!0-9]*) RG_GH_TIMEOUT=30 ;; esac
[ "$RG_GH_TIMEOUT" -gt 0 ] 2>/dev/null || RG_GH_TIMEOUT=30

# rg_gh <gh args...>: run gh; a call that exceeded the timeout returns 124.
rg_gh() {
    if command -v timeout >/dev/null 2>&1; then
        timeout "$RG_GH_TIMEOUT" gh "$@"
    else
        gh "$@"
    fi
}
