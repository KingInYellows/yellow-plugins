---
"gt-workflow": minor
---

Add two platform-level guards motivated by the Graphite merge-queue research:

- `gt-setup` Phase 1 now detects whether GitHub native merge queue is configured
  for the repo and emits a soft advisory if so. Graphite and GitHub native
  queue are incompatible — running both causes Graphite to restart CI on
  queued commits and may produce out-of-order merges. Detection uses
  `gh api graphql` to query `repository.mergeQueue.url`. Fail-open on any
  error (`COULD NOT CHECK`) so setup is never blocked.
- `gt-cleanup` now distinguishes "closed without merging" from "merged" in
  the Closed PR category. When any closed PR has `mergedAt: null` (queue
  ejection, abandoned PR, or any close-without-land), the branch is tagged
  and a count warning appears in "Delete all" mode, plus a per-branch
  `closed (no merge — verify before deleting)` line in "Review individually"
  mode. Adds `mergedAt` to the existing `gh pr list --json` call — no new
  API requests.

Both changes apply to **all** Graphite users, not just users of Graphite's
optional merge queue. No new dependencies. No breaking changes.
