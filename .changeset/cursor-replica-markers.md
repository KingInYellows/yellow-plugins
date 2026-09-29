---
'yellow-cursor': patch
---

Mark the units yellow-jules copies (`validateRef`, `validateIdempotencyKey`,
`assertNoSecretShapedValues`, `redactDeep`, `resolveDataDir`, `AppError`,
`makeAppError`) with `// replica:` comments so a drift check keeps the copies
identical. Comment-only change; no behavior change.
