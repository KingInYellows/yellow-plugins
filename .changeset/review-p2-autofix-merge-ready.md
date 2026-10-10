---
'yellow-review': minor
---

`/review:pr` and `/review:all` now auto-apply up to 5 P2 `safe_auto` findings
at confidence anchor 100, after the P0/P1 fixes. `/review:sweep` adds a
`Merge:` row and `/review:sweep-all` a `Not merge-ready` line when P0-P2
ledger findings are still pending, and `review-ledger.sh summary` reports a
`merge_blocking` count.
