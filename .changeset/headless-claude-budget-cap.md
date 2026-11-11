---
'yellow-core': minor
---

Cap every background compounding drain with `--max-budget-usd` (3.00 by default,
`COMPOUND_DRAIN_MAX_BUDGET_USD` overrides it) and log the drain's
`total_cost_usd` in its drain log. `/compound:review-staged` now pins the same
model as the SessionStart drain (Haiku unless `COMPOUND_DRAIN_MODEL` is set) and
uses the same cap; before, a manual drain ran on the session's default model.
