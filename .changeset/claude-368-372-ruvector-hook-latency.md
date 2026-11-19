---
'yellow-ruvector': minor
---

Session start no longer waits for a semantic recall (CLAUDE-368). The hook
injects the recall a background job saved at the previous session start, then
refreshes it in the background: p95 about 90 ms instead of 1.6 s. Only results
scoring 0.3 or more are injected (`RUVECTOR_RECALL_MIN_SCORE` moves the floor),
as plain bullets instead of the CLI's JSON, and the block stays under 2 KB. A
project's first session after upgrading injects no recall.

Co-edit recording writes `.ruvector/coedit.json` in a detached job, so an edit
that records a pair returns in about 60 ms instead of 110-120 ms (CLAUDE-372).
