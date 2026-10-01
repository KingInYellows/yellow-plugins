# shell-compat: library
# Process and log helpers for run-verify-command (bash; sourced after
# resolve-paths.sh). They hold no state: every value comes in as an argument.
# shellcheck shell=bash

# vr_timeout_bin: print a timeout binary that supports --kill-after, or fail.
# YELLOW_REVIEW_NO_TIMEOUT_BIN=1 forces the failure (tests the watchdog).
vr_timeout_bin() {
    [ "${YELLOW_REVIEW_NO_TIMEOUT_BIN:-0}" = 1 ] && return 1
    local t
    for t in timeout gtimeout; do
        if command -v "$t" >/dev/null 2>&1 && "$t" --kill-after=1 1 true >/dev/null 2>&1; then
            printf '%s' "$t"
            return 0
        fi
    done
    return 1
}

# vr_watchdog <pgid> <seconds> <marker> <kill-after>: sleep, create <marker>
# (so a real timeout is told apart from a command that exits 124), TERM the
# process group, then KILL what is still alive after <kill-after> seconds.
# Run it in a background subshell.
vr_watchdog() {
    local pgid="$1" secs="$2" marker="$3" kill_after="$4" i
    exec >/dev/null 2>&1 </dev/null
    sleep "$secs"
    : >"$marker"
    kill -s TERM -- "-$pgid" 2>/dev/null
    # Poll the group so a timeout returns as soon as it has exited.
    i=$((kill_after * 5))
    while [ "$i" -gt 0 ] && kill -0 -- "-$pgid" 2>/dev/null; do
        sleep 0.2
        i=$((i - 1))
    done
    kill -s KILL -- "-$pgid" 2>/dev/null
}

# vr_stop_group <pgid> <kill-after>: TERM the group, wait up to <kill-after>
# seconds for it to exit, then KILL what is left.
vr_stop_group() {
    local pgid="$1" i
    [ -n "$pgid" ] || return 0
    kill -s TERM -- "-$pgid" 2>/dev/null || return 0
    i=$(($2 * 5))
    while [ "$i" -gt 0 ] && kill -0 -- "-$pgid" 2>/dev/null; do
        sleep 0.2
        i=$((i - 1))
    done
    kill -s KILL -- "-$pgid" 2>/dev/null
    return 0
}

# vr_log_stream <fifo> <log> <cap-bytes>: copy <fifo> to <log>, keeping only
# the last <cap-bytes> (failures usually print last). tail holds at most the
# cap in memory and always drains its input, so the command writing to <fifo>
# never blocks or gets SIGPIPE however much it prints. <log> is written when
# the stream ends and keeps the mode it was created with.
vr_log_stream() {
    tail -c "$3" <"$1" >"$2"
}

# vr_drain_log <stream-pid> <command-pgid> <log>: wait for the vr_log_stream
# job to see end-of-input. A process that outlived the command and still holds
# the stream open is killed along with the rest of the command's group; if the
# stream is still open after that (a process in another session), the log is
# withheld rather than left half-written. Returns 1 when withheld.
vr_drain_log() {
    local pid="$1" pgid="$2" log="$3" i=0
    while [ "$i" -lt 50 ]; do
        kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null; return 0; }
        sleep 0.1
        i=$((i + 1))
    done
    kill -s KILL -- "-$pgid" 2>/dev/null
    i=0
    while [ "$i" -lt 20 ]; do
        kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null; return 0; }
        sleep 0.1
        i=$((i + 1))
    done
    kill -s KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    (umask 077 && printf '[withheld: a process kept the output open after the command exited]\n' >|"$log")
    return 1
}

# vr_core_lib <plugin-root>: print yellow-core's compound-staging.sh (source
# tree first, then the installed cache), or fail.
vr_core_lib() {
    rp_sibling_file "$1" yellow-core lib/compound-staging.sh
}

# vr_redact_log <log> <plugin-root>: redact the finished log in place. A
# verifier can echo its environment. Without yellow-core's cs_redact_secrets,
# or when it fails, the log is replaced by a notice rather than kept raw.
vr_redact_log() {
    local log="$1" lib
    # Always source the canonical definition: a PATH executable of the same
    # name must never stand in for it.
    lib=$(vr_core_lib "$2") || lib=""
    # A source checkout's copy may carry uncommitted resolver edits (it is not
    # an rp_runner path). Sourcing it would run that code after verification,
    # so refuse a copy that is modified, untracked or unverifiable in git.
    if [ -n "$lib" ] && git -C "${lib%/*}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        local dirty
        dirty=$(git -C "${lib%/*}" status --porcelain --ignored=no -- "${lib##*/}" 2>/dev/null) \
            && [ -z "$dirty" ] && git -C "${lib%/*}" ls-files --error-unmatch -- "${lib##*/}" >/dev/null 2>&1 \
            || lib=""
    fi
    # shellcheck disable=SC1090
    [ -n "$lib" ] && . "$lib" 2>/dev/null
    if declare -F cs_redact_secrets >/dev/null 2>&1 \
        && (umask 077 && cs_redact_secrets <"$log" >"$log.tmp" 2>/dev/null) \
        && mv -f -- "$log.tmp" "$log"; then
        return 0
    fi
    rm -f -- "$log.tmp"
    (umask 077 && printf '[withheld: log redaction unavailable]\n' >|"$log") || rm -f -- "$log"
}

# vr_cap_log <log> <cap-bytes>: keep the tail of an oversized log.
vr_cap_log() {
    if [ "$(wc -c <"$1")" -gt "$2" ]; then
        (umask 077 && tail -c "$2" <"$1" >"$1.tmp") && mv -f -- "$1.tmp" "$1"
    fi
}

# vr_prune <dir> <pr> <ext> <keep>: keep the newest <keep> files of one PR
# (<dir>/<pr>-*.<ext>); other PRs' files are never touched.
vr_prune() {
    local f n=0
    while IFS= read -r f; do
        n=$((n + 1))
        [ "$n" -gt "$4" ] && rm -f -- "$f"
    done < <(ls -1t -- "$1/$2"-*."$3" 2>/dev/null)
}
