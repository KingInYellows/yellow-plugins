# shell-compat: library
# Shared by reply-pr-thread, file-followup-issue and get-pr-blockers (POSIX sh;
# sourced).
# A gh call that hangs must not hold the caller's Bash tool call open, so
# every gh call here runs under timeout(1) or gtimeout(1) when one is installed.
# shellcheck shell=sh

# Seconds per gh call (YELLOW_REVIEW_GH_TIMEOUT, default 30). timeout(1)
# treats 0 as "no limit", so 0 or a non-number falls back to the default.
RG_GH_TIMEOUT="${YELLOW_REVIEW_GH_TIMEOUT:-30}"
case "$RG_GH_TIMEOUT" in ''|*[!0-9]*) RG_GH_TIMEOUT=30 ;; esac
[ "$RG_GH_TIMEOUT" -gt 0 ] 2>/dev/null || RG_GH_TIMEOUT=30

# GNU coreutils on macOS installs it as gtimeout.
RG_TIMEOUT_BIN=""
for _rg_t in timeout gtimeout; do
    if command -v "$_rg_t" >/dev/null 2>&1; then RG_TIMEOUT_BIN=$_rg_t; break; fi
done
[ -n "$RG_TIMEOUT_BIN" ] || printf 'Note: neither timeout nor gtimeout is installed; gh calls run without a time limit.\n' >&2

# rg_gh <gh args...>: run gh; with timeout(1) or gtimeout(1) installed, a call
# that exceeded the timeout returns 124. Without either, gh runs unbounded.
rg_gh() {
    if [ -n "$RG_TIMEOUT_BIN" ]; then
        "$RG_TIMEOUT_BIN" "$RG_GH_TIMEOUT" gh "$@"
    else
        gh "$@"
    fi
}

# Failure classifiers over a file holding gh's stderr. Test a rate limit
# before a permission failure: a secondary rate limit is also an HTTP 403.
# rg_is_rate_limited <err-file>
rg_is_rate_limited() {
    grep -qiE 'rate limit|abuse|HTTP 429' "$1"
}

# rg_is_auth_failure <err-file>: the credentials are missing or rejected; no
# retry helps until a human re-authenticates.
rg_is_auth_failure() {
    grep -qiE 'HTTP 401|Bad credentials|gh auth login|authentication (failed|required)' "$1"
}

# rg_is_permission_denied <err-file>: the account may not do this (HTTP 403,
# a token without the scope) or the repository has Issues turned off. Both
# are permanent for the caller: a retry gets the same answer.
rg_is_permission_denied() {
    grep -qiE 'HTTP 403|Resource not accessible|FORBIDDEN|has disabled issues|issues are disabled' "$1"
}
