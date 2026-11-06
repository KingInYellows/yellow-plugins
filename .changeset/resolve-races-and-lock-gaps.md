---
'yellow-review': minor
'yellow-core': patch
---

Narrow the remaining resolve races and review-run lock gaps (CLAUDE-270,
CLAUDE-271). `apply-thread-actions --expected-head` re-reads the PR head before
each thread and stops with `reason=head-moved` when another writer pushed
mid-batch; `/review:resolve` passes it. `commit-resolve-fixes` gives its two
head checks one shared ls-remote budget so several push URLs cannot stretch the run.
`/review:resolve` and `/review:sweep` refresh their review-run holder during
long runs. In yellow-core, manual `/compound:review-staged` refuses to start a
drain while a review holds the checkout, and the SessionStart hook never
drains a symlinked staging dir.
