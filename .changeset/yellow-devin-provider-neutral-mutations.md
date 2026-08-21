---
"yellow-devin": minor
---

`devin:review-prs` now resolves the active stacked-PR provider once via
`stack-provider-router` before committing, instead of hardcoding Graphite.
The Graphite path is unchanged.
