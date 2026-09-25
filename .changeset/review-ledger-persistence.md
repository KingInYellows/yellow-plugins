---
'yellow-review': minor
---

`/review:pr` and `/review:all` now persist every reported-but-unapplied finding
to a per-PR review-findings ledger inside the clone's git dir, inject
still-applicable dismissed findings into reviewer prompts, and record applied
fixes through to `fixed` once they are proved published. `/review:setup` checks
the ledger's prerequisites.
