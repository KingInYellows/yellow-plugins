---
'yellow-core': minor
'yellow-review': minor
---

The compound-staging drain no longer writes into a checkout that a review is
resolving (CLAUDE-267). `/review:resolve`, `/review:sweep`, `/review:sweep-all`
and `/review:resolve-stack` hold a review-run lock (yellow-review's new
`review-run-lock` script). While it is held, yellow-core's SessionStart hook
starts no drain and `staging-promoter` defers its write, so the drain's
`.promote-done` sentinels can no longer trip resolve's ignored-file stop.
`/review:sweep-all` also stops before the first PR when a drain is already
running.
