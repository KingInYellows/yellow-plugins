---
"yellow-debt": minor
---

The `debt-fixer` agent and `debt:fix` command now resolve the active
stacked-PR provider once via `stack-provider-router` before committing,
instead of hardcoding Graphite. The Graphite path is unchanged.
