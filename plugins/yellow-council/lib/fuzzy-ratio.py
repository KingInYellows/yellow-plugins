#!/usr/bin/env python3
"""Tier 2 evidence scorer for /council (council_verify_findings).

Reads JSONL on stdin, one row per finding: {"id", "quote", "lines": [...]},
where the quote and the window lines are already redacted and
whitespace-normalized. Writes one JSON object per row to stdout:
{"id", "score"} with score = max over the lines of fuzz.ratio, and of
fuzz.partial_ratio too when the quote has at least 16 characters (ratio alone
caps an exact fragment of a longer line near 50; the floor stops a short quote
scoring 100 against almost any line). A quote with fewer than 8 characters
outside [REDACTED] placeholders gets {"id", "score": 0, "short": true}.

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
MIN_CHARS = 8


def compact_len(text):
    return len("".join(text.replace("[REDACTED]", "").split()))


def score(quote, lines):
    best = 0.0
    for line in lines:
        value = fuzz.ratio(quote, line)
        if len(quote) >= PARTIAL_MIN_CHARS:
            value = max(value, fuzz.partial_ratio(quote, line))
        best = max(best, value)
    return round(best, 2)


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        row = json.loads(raw)
        quote = row.get("quote") or ""
        lines = [line for line in row.get("lines") or [] if isinstance(line, str)]
        if compact_len(quote) < MIN_CHARS:
            out = {"id": row["id"], "score": 0, "short": True}
        else:
            out = {"id": row["id"], "score": score(quote, lines)}
        sys.stdout.write(json.dumps(out) + "\n")


if __name__ == "__main__":
    main()
