#!/usr/bin/env python3
"""Tier 2 evidence scorer for /council (council_verify_findings).

Reads JSONL on stdin, one row per finding: {"id", "quote", "lines": [...]},
where the quote and the window lines are already redacted and
whitespace-normalized. Writes one JSON object per row to stdout:
{"id", "score"} with score = max over the lines of fuzz.ratio, and of
fuzz.partial_ratio too when the quote has at least 16 characters and is the
needle: the line is at least as long as the quote and has 8 or more
characters outside [REDACTED] placeholders. ratio alone caps an exact fragment
of a longer line near 50; the floor stops a short quote scoring 100 against
almost any line; and partial_ratio aligns the shorter string inside the
longer, so without the needle rule a fabricated quote that merely contains
`}` would score 100 against a lone `}` line. partial_ratio is skipped above
1024 quote characters (or a line over 4096) to bound its cost, and both
scorers take score_cutoff=85. A quote with fewer than 8 characters outside
placeholders gets {"id", "score": 0, "short": true}. Each row is flushed as
it is scored, so a caller's timeout keeps the rows already done.

Takes no arguments and touches no files. Exits 3 when rapidfuzz cannot be
imported, so the caller can tell "skipped" from "failed".
"""
import json
import sys

try:
    from rapidfuzz import fuzz
except ImportError:
    sys.exit(3)

PARTIAL_MIN_CHARS = 16
PARTIAL_MAX_CHARS = 1024
MIN_CHARS = 8
CUTOFF = 85
# Each [REDACTED] placeholder becomes one private-use character on both
# sides, so a quote holding a broken "[REDACTED" cannot match it and counts
# as ordinary text.
PLACEHOLDER = "\ue000"


def canon(text):
    return text.replace("[REDACTED]", PLACEHOLDER)


def compact_len(text):
    return len("".join(text.replace(PLACEHOLDER, "").split()))


def score(quote, lines):
    # Only >= CUTOFF is ever used, so score_cutoff lets rapidfuzz prune.
    best = 0.0
    for line in lines:
        value = fuzz.ratio(quote, line, score_cutoff=CUTOFF)
        if (
            PARTIAL_MIN_CHARS <= len(quote) <= PARTIAL_MAX_CHARS
            and len(quote) <= len(line) <= PARTIAL_MAX_CHARS * 4
            and compact_len(line) >= MIN_CHARS
        ):
            value = max(value, fuzz.partial_ratio(quote, line, score_cutoff=CUTOFF))
        best = max(best, value)
    return best


def main():
    # Strict: the caller's jq always emits valid UTF-8, and a lossy decode
    # could make distinct bytes compare equal. A decode error exits non-zero;
    # rows already flushed keep their scores and the rest are verifier-error.
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        row = json.loads(raw)
        quote = canon(row["quote"])
        lines = [canon(line) for line in row["lines"]]
        if compact_len(quote) < MIN_CHARS:
            out = {"id": row["id"], "score": 0, "short": True}
        else:
            out = {"id": row["id"], "score": score(quote, lines)}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
