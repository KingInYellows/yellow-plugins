# shell-compat: library
# Process and log helpers for run-verify-command (bash; sourced after
# resolve-paths.sh). They hold no state. Values come in as arguments, except
# that vr_timeout_bin reads YELLOW_REVIEW_NO_TIMEOUT_BIN and vr_load_redactor
# sources yellow-core's compound-staging.sh (found through sp_sibling_file).
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

# vr_watchdog <pgid> <seconds> <marker> <kill-after>: sleep, create <marker>
# (so a real timeout is told apart from a command that exits 124), then stop
# the process group with vr_stop_group. Run it in a background subshell.
vr_watchdog() {
    exec >/dev/null 2>&1 </dev/null
    sleep "$2"
    : >"$3"
    vr_stop_group "$1" "$4"
}

# vr_drain_log <stream-pid> <command-pgid> <log>: wait for the log stream job
# (a background subshell running vr_redact_stream | tail -c <cap + context>) to see
# end-of-input. A process that outlived the
# command and still holds the stream open is killed along with the rest of the
# command's group; if the stream is still open after that (a process in
# another session), the log is withheld rather than left half-written.
# Returns 0 when the stream ended cleanly, 1 when the log was withheld, 2 when
# the stream job itself failed (the log may be incomplete).
vr_drain_log() {
    local pid="$1" pgid="$2" log="$3" i=0
    while [ "$i" -lt 50 ]; do
        kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null || return 2; return 0; }
        sleep 0.1
        i=$((i + 1))
    done
    kill -s KILL -- "-$pgid" 2>/dev/null
    i=0
    while [ "$i" -lt 20 ]; do
        kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null || return 2; return 0; }
        sleep 0.1
        i=$((i + 1))
    done
    # The stream job is a job-control group of its own (pgid = its pid): kill
    # the redactor and tail along with the subshell.
    kill -s KILL -- "-$pid" 2>/dev/null
    kill -s KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    (umask 077 && printf '[withheld: a process kept the output open after the command exited]\n' >|"$log")
    return 1
}

# vr_load_redactor <plugin-root>: source yellow-core's lib/compound-staging.sh
# (source tree first, then the installed cache; see sp_sibling_file) so that
# cs_redact_secrets is defined. Returns 1 when the library is missing, or is a
# source-checkout copy that is modified, untracked or unverifiable in git: it
# may carry uncommitted resolver edits (it is not an rp_runner path), and
# sourcing it would run that code after verification. Call it before the
# verifier starts so the checked copy is the one that runs.
vr_load_redactor() {
    local lib dirty
    # Always source the canonical definition: a PATH executable of the same
    # name must never stand in for it.
    lib=$(sp_sibling_file "$1" yellow-core lib/compound-staging.sh) || lib=""
    if [ -n "$lib" ] && git -C "${lib%/*}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        # Same integrity rule as rp_runtime_override_untrusted: git status, git
        # diff and a bare ls-files all miss an edit hidden by assume-unchanged
        # or skip-worktree, so the index flag must be the plain "H " (tracked,
        # not hidden) and the file's content hash must equal its blob in HEAD.
        local dir="${lib%/*}" name="${lib##*/}" st blob
        st=$(lgit -C "$dir" ls-files -v --error-unmatch -- "$name" 2>/dev/null) \
            && [ "${st:0:2}" = "H " ] \
            && dirty=$(lgit -C "$dir" status --porcelain --ignored=no -- "$name" 2>/dev/null) \
            && [ -z "$dirty" ] \
            && blob=$(lgit -C "$dir" rev-parse --verify --quiet "HEAD:./$name" 2>/dev/null) \
            && [ -n "$blob" ] \
            && [ "$(lgit -C "$dir" hash-object -- "$name" 2>/dev/null)" = "$blob" ] \
            || lib=""
    fi
    [ -n "$lib" ] || return 1
    # shellcheck disable=SC1090
    . "$lib" 2>/dev/null
}

# vr_redact_filter: stdin to stdout, the redaction rules and nothing else.
# cs_redact_secrets has no rule for env-style credential names such as
# DEVIN_ORG_ID=org-1234567, so a second pass blanks the rest of any line that
# assigns a *_KEY/_TOKEN/_SECRET/_ID/_PASSWORD name. Both passes are sed, so
# they work on a stream: PEM blocks are a sed range, which drops its lines
# until the END line arrives.
# Both sed passes hold a whole input line in memory, so the stream is first cut
# into records of at most 64 KiB (fold -b -s -w 65536: POSIX, byte-based, breaks
# after the last blank inside the window and hard-breaks only a run of 64 KiB
# with no blank). Minified output or binary data without newlines therefore
# costs one bounded record per filter, not the whole stream. This inserts a
# newline at each break, which can sever a credential assignment from its value
# (more than 64 KiB of blanks between them): the filters would redact only the
# first piece. So the filter fails closed. Two wc taps count the newlines
# before and after fold (fold adds newlines and nothing else), in O(1) memory;
# if fold added any, the output ends with VR_FOLD_SENTINEL and the caller
# (vr_publish_log, vr_redact_log) withholds the stream instead of publishing
# it. Counts that cannot be read count as a boundary. The counts travel on fd 4
# through a command substitution; the data goes to fd 3, this function's stdout.
VR_FOLD_SENTINEL='[yellow-review: output had a record longer than 64 KiB]'
vr_redact_filter() {
    local counts rc=0 tag val n_in="" n_out=""
    { counts=$(
        {
            tee >(printf 'in %s\n' "$(wc -l)" >&4) \
                | fold -b -s -w 65536 \
                | tee >(printf 'out %s\n' "$(wc -l)" >&4) \
                | cs_redact_secrets 2>/dev/null \
                | sed -E 's/(^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_ID|_PASSWORD)[[:space:]]*[=:][[:space:]]*).*/\1\2[REDACTED]/'
        } 4>&1 >&3
    ) || rc=$?; } 3>&1
    while read -r tag val; do
        case "$tag" in
            in) n_in="$val" ;;
            out) n_out="$val" ;;
        esac
    done <<<"$counts"
    if [[ "$n_in" =~ ^[0-9]+$ ]] && [[ "$n_out" =~ ^[0-9]+$ ]] && [ "$n_in" -eq "$n_out" ]; then
        return "$rc"
    fi
    printf '\n%s\n' "$VR_FOLD_SENTINEL"
    return "$rc"
}

# vr_fold_withheld <file>: succeeds when <file> (filter output) ends with
# VR_FOLD_SENTINEL, i.e. fold cut a record and the stream must be withheld. A
# stream whose last line merely ends in the same text is withheld too; that is
# the safe side.
vr_fold_withheld() {
    [ "$(tail -c $((${#VR_FOLD_SENTINEL} + 1)) <"$1" 2>/dev/null)" = "$VR_FOLD_SENTINEL" ]
}

# vr_redact_stream: redact stdin to stdout as it arrives, so the verifier's raw
# output never reaches a file. vr_load_redactor must have run first. Without
# cs_redact_secrets the stream is replaced by a notice. It always reads stdin to
# the end (also after a filter failure) so the writer never blocks or gets
# SIGPIPE. Returns the filter's status.
vr_redact_stream() {
    local rc=0
    if declare -F cs_redact_secrets >/dev/null 2>&1 && command -v fold >/dev/null 2>&1; then
        (set -o pipefail; vr_redact_filter) || rc=$?
    else
        rc=1
        printf '[withheld: log redaction unavailable]\n'
    fi
    cat >/dev/null
    return "$rc"
}

# vr_write_log_tail <stream-file> <log> <cap>: copy the last <cap> bytes of
# <stream-file> to <log>. When the cut falls inside a line, that partial first
# line is dropped. A stream of at most <cap> bytes is copied whole.
vr_write_log_tail() {
    local src="$1" log="$2" cap="$3" size lead
    size=$(wc -c <"$src" 2>/dev/null) || size=0
    size=${size//[[:space:]]/}
    if [[ "$cap" =~ ^[0-9]+$ ]] && [[ "$size" =~ ^[0-9]+$ ]] && [ "$cap" -gt 0 ] && [ "$size" -gt "$cap" ]; then
        # The byte before the retained suffix: a newline means the cut fell on
        # a line boundary and the first retained line is whole.
        lead=$(tail -c $((cap + 1)) -- "$src" 2>/dev/null | head -c 1 | od -An -tx1 | tr -d ' \n')
        if [ "$lead" = 0a ]; then
            (umask 077 && tail -c "$cap" -- "$src" >|"$log")
        else
            (umask 077 && tail -c "$cap" -- "$src" | sed '1d' >|"$log")
        fi
        return
    fi
    (umask 077 && cat -- "$src" >|"$log")
}

# vr_publish_log <stream-file> <log> [<cap>]: write the redacted, bounded stream
# to the final log path, but only after the last credential scan
# (rt_code_clean, from resolve-text.sh). <stream-file> may hold more than
# <cap> bytes: run-verify-command keeps extra context before the cap so the scan
# sees a credential label whose value starts the published suffix. The scan
# covers the whole <stream-file>; only its last <cap> bytes (see
# vr_write_log_tail) are published, and only when the scan was clean. A stream
# that still looks like a credential, or that cannot be scanned, is replaced by
# a notice. Fail closed: the log path never holds text that has not passed the
# scan. A stream in which fold cut a record (vr_fold_withheld) is replaced by a
# notice and the function returns 3, so the caller can name it in the result's
# reason; every other outcome returns 0.
vr_publish_log() {
    local src="$1" log="$2" cap="${3:-0}"
    if vr_fold_withheld "$src"; then
        (umask 077 && printf '[log withheld: output had a record longer than 64 KiB]\n' >|"$log") || rm -f -- "$log"
        return 3
    fi
    if declare -F rt_code_clean >/dev/null 2>&1; then
        if rt_code_clean "$src"; then
            vr_write_log_tail "$src" "$log" "$cap" && return 0
            (umask 077 && printf '[withheld: the log could not be written]\n' >|"$log") || rm -f -- "$log"
            return 0
        fi
        (umask 077 && printf '[withheld: log still looks like a credential after redaction]\n' >|"$log") || rm -f -- "$log"
        return 0
    fi
    (umask 077 && printf '[withheld: log redaction unavailable]\n' >|"$log") || rm -f -- "$log"
}

# vr_redact_log <log> <plugin-root>: redact a finished log in place with the
# same rules as vr_redact_stream. Without cs_redact_secrets, or when it fails,
# the log is replaced by a notice rather than kept raw. run-verify-command
# streams instead; this serves callers that already hold a log file.
vr_redact_log() {
    local log="$1"
    vr_load_redactor "$2"
    # A final scan (rt_code_clean, from resolve-text.sh) fails closed: a log
    # that still looks like a credential, or that cannot be scanned, is
    # withheld.
    local scan_rc=2
    if declare -F cs_redact_secrets >/dev/null 2>&1 \
        && command -v fold >/dev/null 2>&1 \
        && declare -F rt_code_clean >/dev/null 2>&1 \
        && (
            umask 077
            set -o pipefail
            vr_redact_filter <"$log" >"$log.tmp"
        ); then
        if vr_fold_withheld "$log.tmp"; then
            rm -f -- "$log.tmp"
            (umask 077 && printf '[log withheld: output had a record longer than 64 KiB]\n' >|"$log") || rm -f -- "$log"
            return 0
        fi
        scan_rc=0
        rt_code_clean "$log.tmp" || scan_rc=$?
        if [ "$scan_rc" -eq 0 ] && mv -f -- "$log.tmp" "$log"; then
            return 0
        fi
        rm -f -- "$log.tmp"
        if [ "$scan_rc" -ne 0 ]; then
            (umask 077 && printf '[withheld: log still looks like a credential after redaction]\n' >|"$log") || rm -f -- "$log"
            return 0
        fi
    fi
    rm -f -- "$log.tmp"
    (umask 077 && printf '[withheld: log redaction unavailable]\n' >|"$log") || rm -f -- "$log"
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
