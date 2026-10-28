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
# Only `user` and `assistant` records are kept: Claude Code 2.1.300+ also
# writes `attachment` records (prompt_snapshot with the full system prompt and
# tool schemas, skill and MCP listings, memory files) that can run to hundreds
# of KB and would otherwise fill the tail. Lines that are not JSON objects
# with a `type` pass through unchanged.
# The scan starts at the last TAIL_SCAN_LINES lines and doubles until it holds
# TAIL_LINES records, already exceeds the byte cap, covers the whole file, or
# reaches TAIL_SCAN_MAX_LINES. A fixed window let a run of non-dialogue
# records push every dialogue line out, and empty tails from different
# sessions share a content hash, so drain dedup dropped all but one.
# If the jq filter fails, fall back to the raw tail minus attachment lines.
# After redaction the staged tail is capped at TAIL_MAX_BYTES, keeping the
# newest whole lines; the Jev shadow gets the uncapped tail so it still sees
# whole records and applies its own cap.
# The transcript file may be missing or unreadable (race with Claude Code
# cleanup); silently produce empty tail in that case.
TAIL_LINES=100
TAIL_SCAN_LINES=1000
TAIL_SCAN_MAX_LINES=128000
TAIL_MAX_BYTES=98304
TAIL_RAW=""
if [ -f "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
  TOTAL_LINES=$(wc -l < "$TRANSCRIPT" 2>/dev/null | tr -d ' ') || TOTAL_LINES=0
  scan=$TAIL_SCAN_LINES
  while :; do
    # shellcheck disable=SC2016  # $l is a jq variable, not a shell one.
    if ! TAIL_RAW=$(tail -n "$scan" -- "$TRANSCRIPT" 2>/dev/null \
        | jq -Rr '. as $l | (try fromjson catch null) as $j
            | if ($j | type) == "object" and ($j | has("type")) then
                if $j.type == "user" or $j.type == "assistant" then $l else empty end
              else $l end' 2>/dev/null \
        | tail -n "$TAIL_LINES"); then
      TAIL_RAW=$(tail -n "$TAIL_LINES" -- "$TRANSCRIPT" 2>/dev/null \
        | grep -v '^{"type":"attachment"' || printf '')
      break
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

if [ "$JEV_ON" = 1 ]; then
  # Raw tail: the lib redacts the projected text itself, because redacting
  # serialized JSONL first can break a line (a URL token pattern can consume
  # the closing quote) and silently drop the newest message.
  # A here-string, not a pipe: the lib often returns without reading stdin,
  # and a pipe writer would then die of SIGPIPE (exit 141).
  jev_prefilter_shadow "$STAGING_DIR" "$SESSION_ID" "$CONTENT_HASH" \
    <<< "$TAIL_RAW" || true
fi
