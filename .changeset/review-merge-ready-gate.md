---
'yellow-review': minor
---

Add `/review:merge-ready`, a read-only merge gate for one PR. Its
`check-merge-ready` script reports unresolved review threads (outdated
included), `CHANGES_REQUESTED` reviewers, a missing required review, the
head commit's CI rollup, draft and conflict state, conversation-resolution
enforcement, the `graphite-queue` label and pending P0-P2 ledger findings,
and exits 0 ready, 1 blocked or 3 unknown. It never writes to GitHub or the
ledger.
