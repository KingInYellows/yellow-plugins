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

# Require jq for JSON build.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Read up to 100 lines of the transcript (PII cap per D12). The transcript
# file may be missing or unreadable (race with Claude Code cleanup); silently
# produce empty tail in that case.
TAIL_RAW=""
if [ -f "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
  TAIL_RAW=$(tail -n 100 -- "$TRANSCRIPT" 2>/dev/null || printf '')
fi

# Redact secrets BEFORE hashing or writing.
TAIL_REDACTED=$(printf '%s' "$TAIL_RAW" | cs_redact_secrets 2>/dev/null || printf '')

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
# directly into a printf format string.
ENTRY=$(jq -nc \
  --arg ts "$TIMESTAMP" \
  --arg sid "$SESSION_ID" \
  --arg hash "$CONTENT_HASH" \
  --arg cwd "$CWD" \
  --arg tail "$TAIL_REDACTED" \
  '{
     schema: "1",
     schema_min_reader: "1",
     timestamp: $ts,
     session_id: $sid,
     content_hash: $hash,
     cwd: $cwd,
     transcript_tail: $tail
   }') || exit 0

# Atomic write: tmp/ then mv to pending/. The tmp/ and pending/ subdirs are
# siblings under STAGING_DIR — guaranteed same filesystem — so rename(2) is
# atomic. cs_atomic_jsonl_write handles the tmp + mv internally; we just
# point it at the final destination.
PENDING_PATH="${STAGING_DIR}/pending/${SESSION_ID}.jsonl"
cs_atomic_jsonl_write "$PENDING_PATH" "$ENTRY" || exit 0
