---
'yellow-core': patch
---

yellow-core adds `lib/quote-ground.sh`, a bash program that is executed and
never sourced. `check` reads a quote from stdin and reports whether it is
grounded inside the cited line window after per-line secret redaction,
placeholder canonicalization, and whitespace normalization. `batch` does the
same for JSONL findings. No command interface changes.
