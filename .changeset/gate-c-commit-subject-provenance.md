---
'yellow-core': patch
---

`/plan:complete` Gate C now passes plans delivered through Graphite's merge
queue. Those PRs stay closed with `merged: false`, so GitHub's commit-to-PR
lookup returned nothing and every archive needed a manual override. When the
lookup succeeds with an empty result, the provenance tier reads the PR number
from the commit subject (new `lib/plan-gate-provenance.sh`) and passes only if
that PR is closed, lists the plan with the same blob as trunk, and changed a
file outside `plans/` whose blob matches the commit's and which the commit
itself changed; the trailer is `Plan-Verifier-FileProvenance:` with
`via=commit-subject`. The provenance tier is also skipped when the plan no
longer exists on trunk at the commit (a stale checkout of an already-archived
plan), and Phase 4 clears stale temp files at its start.
