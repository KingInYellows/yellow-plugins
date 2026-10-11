---
'yellow-core': patch
---

`/plan:complete` Gate C now passes plans delivered through Graphite's merge
queue. Those PRs stay closed with `merged: false`, so GitHub's commit-to-PR
lookup returned nothing and every archive needed a manual override. When the
lookup succeeds with an empty result, the provenance tier falls back to the PR
number in the commit subject (new `lib/plan-gate-provenance.sh`, whose header
states the pass conditions); the trailer is `Plan-Verifier-FileProvenance:` with
`via=commit-subject`. The whole tier is now `pgp_tier_run`, covered by bats. A
plan completed on an unlanded branch no longer borrows the landed version's
evidence on either path (the commits-API association included), a garbled or
unreadable lookup counts as a failed one, and the base
branch name is no longer printed. Transient causes (open PR, rate limit,
timeout) now stop the command with a retry hint instead of going straight to the
override prompt.
