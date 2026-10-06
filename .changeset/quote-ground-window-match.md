---
'yellow-core': minor
---

yellow-core adds `lib/quote-ground.sh`, a bash program that is executed and
never sourced. `check` reads a quote from stdin and reports whether it is
grounded inside the cited line window after per-line secret redaction,
placeholder canonicalization, and whitespace normalization. `batch` does the
same for JSONL findings and writes one result object per input row. It needs
bash 4.4 or newer, and jq and iconv for `batch`, and writes no temp files.
No command interface changes.
