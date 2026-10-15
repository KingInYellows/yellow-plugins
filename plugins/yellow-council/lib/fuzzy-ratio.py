#!/usr/bin/env python3
"""Tier 2 evidence scorer for /council (council_verify_findings).

Reads the caller's redacted stream on stdin, one tab-separated record per
line: `Q<TAB>id<TAB>quote` or `L<TAB>id<TAB>window line` (anything after the
second tab is text, tabs included). Text is normalized like quote-ground:
[REDACTED:<type>] becomes [REDACTED], tabs become spaces, carriage returns go,
space runs collapse to one, and the ends are trimmed. Records group by id; an
id with no Q record is not scored, and its first Q record is its quote. Bytes
that are not UTF-8 are kept distinct (surrogateescape), never merged by a
lossy decode. Writes one JSON object per scored id to stdout:
{"id", "score"} with score = max over the lines of fuzz.ratio, and of
fuzz.partial_ratio too when the quote has at least 16 characters and is the
needle: the line is at least as long as the quote and has 8 or more
non-whitespace characters outside [REDACTED] placeholders. A score below the
85 cutoff comes back as 0, and an exact substring scores 100. ratio alone caps an exact fragment
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
import re
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


REDACTED_TYPED = re.compile(r"\[REDACTED(:[^\]]*)?\]")


def normalize(text):
    text = REDACTED_TYPED.sub("[REDACTED]", text)
    text = text.replace("\t", " ").replace("\r", "")
    return re.sub(" +", " ", text).strip(" ")


def canon(text):
    return text.replace("[REDACTED]", PLACEHOLDER)


def compact_len(text):
    return len("".join(text.replace(PLACEHOLDER, "").split()))


def score(quote, lines):
    # Only >= CUTOFF is ever used, so score_cutoff lets rapidfuzz prune.
    # An exact substring is a match whatever its length (quote-ground's own
    # rule), so a short exact quote never scores below a fuzzy one.
    if any(quote in line for line in lines):
        return 100.0
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


def read_rows(stream):
    quotes = {}
    lines = {}
    order = []
    for raw in stream:
        parts = raw.rstrip("\n").split("\t", 2)
        if len(parts) != 3 or parts[0] not in ("Q", "L"):
            continue
        tag, row_id, text = parts
        if row_id not in lines:
            lines[row_id] = []
            order.append(row_id)
        if tag == "Q":
            quotes.setdefault(row_id, normalize(text))
        else:
            lines[row_id].append(normalize(text))
    return [(row_id, quotes[row_id], lines[row_id]) for row_id in order if row_id in quotes]


def main():
    sys.stdin.reconfigure(encoding="utf-8", errors="surrogateescape", newline="\n")
    for row_id, quote, window in read_rows(sys.stdin):
        quote = canon(quote)
        window = [canon(line) for line in window]
        if compact_len(quote) < MIN_CHARS:
            out = {"id": row_id, "score": 0, "short": True}
        else:
            out = {"id": row_id, "score": score(quote, window)}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
