---
'yellow-review': patch
---

`review-ledger.sh summary` now reports `skipped` (ledger records the fold could
not read), and a write whose fold skipped records removes the `.pending` sidecar
so the fast path cannot report a ledger as clear. `check-merge-ready` reports
the ledger as `partial` and lists it under `unknowns` when `skipped` is above 0,
`/review:sweep` prints `Merge: unknown (<n> unreadable ledger records)`, and
`/review:sweep-all` lists such PRs as merge readiness unknown (CLAUDE-190).
