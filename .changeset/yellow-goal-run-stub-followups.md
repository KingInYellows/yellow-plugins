---
'yellow-goal': patch
---

Tighten `/goal:run-stub`: the zero-spend check now exempts only an actual
`budget-exhausted` terminal (a budget-exhausted request that ended cancelled
must report zero cost), and the command's request-path validation restores the
explicit safe-character allowlist ahead of the canonical yellow-core check.
