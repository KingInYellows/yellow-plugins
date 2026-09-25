---
'yellow-review': patch
---

Harden and speed up the review-findings ledger after a multi-agent review.
Observe no longer fails on large ledgers (the fold stayed off the command line)
and redacts in batches, so it is about 5x faster. Triage resolves stored paths
by finding id instead of putting PR-controlled file names on a command line.
Restore uses literal pathspecs. Secret detection now catches quoted password and
API-key assignments, and display stripping covers C1, bidi and zero-width
characters. The library also runs on macOS bash 3.2 and BSD realpath. A fix
whose commit a restack rewrote now settles `fixed` by content check even when a
stale local ref still holds the old commit, and a tree that cannot be read (a
partial clone offline) leaves findings unverifiable instead of retiring,
staling or reopening them.
Re-verify no longer uses the redacted, 200-character display scope as the
claim: a markdown scope is re-derived at the matched line and compared by hash,
and a code scope whose display copy was truncated or redacted is unverifiable
rather than wrongly `not_reproduced`.
