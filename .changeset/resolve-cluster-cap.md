---
'yellow-review': minor
---

`/review:resolve` applies the 50-line run cap per cluster:
`commit-resolve-fixes --check-ranges --clusters-from` admits clusters by
severity rank and defers only the ones that do not fit
(`over the 50-line run cap (deferred)`), instead of reverting the whole run.
Non-interactive runs no longer dispatch a resolver for a cluster on a runner
file; its threads stay open with `needs an attended /review:resolve`.
