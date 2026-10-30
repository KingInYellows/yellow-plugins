#!/usr/bin/env bash
# _stop-capture-subshell.sh — runs inside the disowned subshell spawned by
# stop.sh. Reads the transcript tail, redacts secrets, hashes, and writes
# the JSONL pending entry atomically.
#
# Args:
#   $1 — transcript path
#   $2 — session id
#   $3 — staging dir
#   $4 — cwd (for logging context in the entry)
#
# Lifetime: this script runs after the Stop hook's parent exits. All output
# is redirected to /dev/null by the parent's `& disown` wrapper. Exit code
# is irrelevant — failures here cannot block Claude Code.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)"

# shellcheck source=../../lib/compound-staging.sh
. "${SCRIPT_DIR}/../../lib/compound-staging.sh"

TRANSCRIPT="${1:-}"
SESSION_ID="${2:-}"
STAGING_DIR="${3:-}"
CWD="${4:-}"

if [ -z "$TRANSCRIPT" ] || [ -z "$SESSION_ID" ] || [ -z "$STAGING_DIR" ]; then
  exit 0
fi

# Sanitize SESSION_ID to a safe filename component. Replace anything that
# isn't [A-Za-z0-9._-] with `_`. Defends against path traversal (`..`, `/`)
# and shell-meta in the destination filename. Empty result is rejected.
SESSION_ID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9._-' '_')
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "." ] || [ "$SESSION_ID" = ".." ]; then
  exit 0
fi

# Require jq for JSON build.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Read up to TAIL_LINES dialogue records of the transcript (PII cap per D12).
# Only lines that parse as JSON objects of type `user` or `assistant` are
# kept, the same records jev_project_dialogue projects: Claude Code 2.1.300+
# also writes `attachment` records (prompt_snapshot with the full system
# prompt and tool schemas, skill and MCP listings, memory files) that can run
# to hundreds of KB, and passthrough text lines would take dialogue slots.
# A half-written final line does not parse, so it is dropped too.
# The scan starts at the last TAIL_SCAN_LINES lines and doubles until it holds
# TAIL_LINES records, already exceeds the byte cap, covers the whole file, or
# reaches TAIL_SCAN_MAX_LINES. A fixed window let a run of non-dialogue
# records push every dialogue line out.
# If the filter pipeline fails, nothing is staged. The filter is what keeps
# attachment and other non-dialogue records out, and `try fromjson` means bad
# input alone does not fail it, so a failure points at a broken jq or a read
# error. An unfiltered tail would hand the drain the prompt snapshot and
# memory files; skipping loses only this capture, and a later Stop in the
# session may recover the dialogue (within the same record and byte caps).
# After redaction the staged tail is capped at TAIL_MAX_BYTES, keeping the
# newest whole lines; the Jev shadow gets the uncapped tail so it still sees
# whole records and applies its own cap.
# The transcript file may be missing or unreadable (race with Claude Code
# cleanup); that yields an empty tail, which is not staged (see below).
# TRANSCRIPT_BYTES is the size before the read: transcripts only grow, so it
# orders overlapping captures of one session. Every read is bounded to those
# bytes, so two captures with one mark hold the same dialogue: the plain tail
# is kept only when the file did not grow while it was read, otherwise the
# read is redone through `head -c`.
TAIL_LINES=100
TAIL_SCAN_LINES=1000
TAIL_SCAN_MAX_LINES=128000
TAIL_MAX_BYTES=98304
TAIL_RAW=""
TRANSCRIPT_BYTES=0
if [ -f "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
  TRANSCRIPT_BYTES=$(wc -c < "$TRANSCRIPT" 2>/dev/null | tr -d ' ') || TRANSCRIPT_BYTES=0
  TOTAL_LINES=$(wc -l < "$TRANSCRIPT" 2>/dev/null | tr -d ' ') || TOTAL_LINES=0
  SNAP_EXACT=1
  _snapshot_lines() {
    if [ "$SNAP_EXACT" = 1 ]; then
      tail -n "$1" -- "$TRANSCRIPT"
    else
      head -c "$TRANSCRIPT_BYTES" -- "$TRANSCRIPT" | tail -n "$1"
    fi
  }
  scan=$TAIL_SCAN_LINES
  while :; do
    if ! TAIL_RAW=$(_snapshot_lines "$scan" 2>/dev/null \
        | jq -Rr 'select((try fromjson catch null)
            | type == "object" and (.type == "user" or .type == "assistant"))' 2>/dev/null \
        | tail -n "$TAIL_LINES"); then
      TAIL_RAW=""
      break
    fi
    if [ "$SNAP_EXACT" = 1 ] \
        && [ "$(wc -c < "$TRANSCRIPT" 2>/dev/null | tr -d ' ')" != "$TRANSCRIPT_BYTES" ]; then
      SNAP_EXACT=0
      continue
    fi
    # `wc -l` misses an unterminated last line, hence -gt rather than -ge.
    [ "$scan" -gt "${TOTAL_LINES:-0}" ] && break
    [ "$scan" -ge "$TAIL_SCAN_MAX_LINES" ] && break
    if [ -n "$TAIL_RAW" ]; then
      [ "$(printf '%s\n' "$TAIL_RAW" | wc -l)" -ge "$TAIL_LINES" ] && break
      [ "$(printf '%s' "$TAIL_RAW" | wc -c)" -gt "$TAIL_MAX_BYTES" ] && break
    fi
    scan=$((scan * 2))
    [ "$scan" -gt "$TAIL_SCAN_MAX_LINES" ] && scan=$TAIL_SCAN_MAX_LINES
  done
fi

# Redact secrets BEFORE capping, hashing or writing: a byte cut taken first
# could drop a `password=` style label and leave its value unrecognized.
TAIL_REDACTED=$(printf '%s' "$TAIL_RAW" | cs_redact_secrets 2>/dev/null || printf '')
if [ "$(printf '%s' "$TAIL_REDACTED" | wc -c)" -gt "$TAIL_MAX_BYTES" ]; then
  TAIL_REDACTED=$(printf '%s' "$TAIL_REDACTED" | tail -c "$TAIL_MAX_BYTES")
  # Drop the partial first line unless it is the only one.
  case "$TAIL_REDACTED" in
    *$'\n'*) TAIL_REDACTED=${TAIL_REDACTED#*$'\n'} ;;
  esac
fi

# Nothing to stage. Empty tails from different sessions share a content hash,
# so drain dedup would drop all but one of them anyway.
[ -n "$TAIL_REDACTED" ] || exit 0

# Content hash (sha256) for fast dedup at drain time. Hash of the REDACTED
# tail so identical post-redaction sessions collide.
CONTENT_HASH=""
if command -v sha256sum >/dev/null 2>&1; then
  CONTENT_HASH=$(printf '%s' "$TAIL_REDACTED" | sha256sum 2>/dev/null | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
  CONTENT_HASH=$(printf '%s' "$TAIL_REDACTED" | shasum -a 256 2>/dev/null | cut -d' ' -f1)
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Build JSONL entry. jq handles all escaping; we never embed user content
# directly into a printf format string. The tail goes in on stdin, not as
# --arg: Linux caps one argv string at 128 KiB (MAX_ARG_STRLEN); a larger
# tail made exec of jq fail with E2BIG, so the entry was silently dropped.
ENTRY=$(printf '%s' "$TAIL_REDACTED" | jq -Rsc \
  --arg ts "$TIMESTAMP" \
  --arg sid "$SESSION_ID" \
  --arg hash "$CONTENT_HASH" \
  --arg cwd "$CWD" \
  '. as $tail | {
     schema: "1",
     schema_min_reader: "1",
     timestamp: $ts,
     session_id: $sid,
     content_hash: $hash,
     cwd: $cwd,
     transcript_tail: $tail
   }') || exit 0

# Optional Jev shadow pre-filter (off unless COMPOUND_JEV_PREFILTER=shadow and
# TYPESAFE_API_KEY are set). It runs after the pending entry is written, so it
# cannot change what gets staged; it only records decisions under jev-shadow/
# for comparison with staging-scorer outcomes. The directory is created before
# the pending write: the drain records a verdict only when it exists, and a
# drain can claim the entry as soon as it is published.
JEV_LIB="${SCRIPT_DIR}/../../lib/jev-prefilter.sh"
JEV_ON=0
if [ -f "$JEV_LIB" ]; then
  # shellcheck source=../../lib/jev-prefilter.sh
  . "$JEV_LIB"
  if jev_prefilter_enabled; then
    JEV_ON=1
    ( umask 077; mkdir -p "${STAGING_DIR}/jev-shadow" ) 2>/dev/null || true
  fi
fi

# Two Stop events close together start two captures of one session, and the
# older one can finish last. capture-marks/<session> holds the transcript size
# of the newest published capture; a capture that read a smaller transcript
# skips publishing so it cannot replace a newer pending entry, or re-stage
# older dialogue after the drain took the newer one. The check and the
# publish run under a per-session mkdir lock. A lock older than a minute
# belongs to a capture that died holding it; a separate reclaim lock makes
# sure only that stale lock is removed, never a fresh one another waiter just
# took. A capture that cannot get the lock within five seconds does not
# publish: the holder is publishing, and the next Stop captures again.
MARK_DIR="${STAGING_DIR}/capture-marks"
MARK="${MARK_DIR}/${SESSION_ID}"
LOCK="${MARK}.lock"
( umask 077; mkdir -p "$MARK_DIR" ) 2>/dev/null || true
_lock_stale() { [ -n "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }
tries=0
while ! mkdir "$LOCK" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -gt 50 ] && exit 0
  if _lock_stale && mkdir "${LOCK}.reclaim" 2>/dev/null; then
    _lock_stale && { rmdir "$LOCK" 2>/dev/null || true; }
    rmdir "${LOCK}.reclaim" 2>/dev/null || true
    continue
  fi
  sleep 0.1
done
# Single quotes: LOCK holds a project path and must never become trap source.
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
PREV_BYTES=$(cat "$MARK" 2>/dev/null) || PREV_BYTES=0
case "$PREV_BYTES" in '' | *[!0-9]*) PREV_BYTES=0 ;; esac
case "$TRANSCRIPT_BYTES" in '' | *[!0-9]*) TRANSCRIPT_BYTES=0 ;; esac
[ "$PREV_BYTES" -gt "$TRANSCRIPT_BYTES" ] && exit 0

# Atomic write: tmp/ then mv to pending/. The tmp/ and pending/ subdirs are
# siblings under STAGING_DIR — guaranteed same filesystem — so rename(2) is
# atomic. cs_atomic_jsonl_write handles the tmp + mv internally; we just
# point it at the final destination.
PENDING_PATH="${STAGING_DIR}/pending/${SESSION_ID}.jsonl"
# JSONL requires each entry terminated by a newline. cs_atomic_jsonl_write
# does not append \n on its own (the helper is content-agnostic), so the
# caller is responsible for line termination.
cs_atomic_jsonl_write "$PENDING_PATH" "${ENTRY}
" || exit 0
cs_atomic_jsonl_write "$MARK" "$TRANSCRIPT_BYTES" || true
# Marks share the pending entries' 7-day TTL.
find "$MARK_DIR" -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null || true
# Release before the Jev shadow request, which can outlast the waiters' five
# seconds. Clear the trap first so it cannot remove a later capture's lock.
trap - EXIT
rmdir "$LOCK" 2>/dev/null || true

if [ "$JEV_ON" = 1 ]; then
  # Raw tail: the lib redacts the projected text itself, because redacting
  # serialized JSONL first can break a line (a URL token pattern can consume
  # the closing quote) and silently drop the newest message.
  # A here-string, not a pipe: the lib often returns without reading stdin,
  # and a pipe writer would then die of SIGPIPE (exit 141).
  jev_prefilter_shadow "$STAGING_DIR" "$SESSION_ID" "$CONTENT_HASH" \
    <<< "$TAIL_RAW" || true
fi
