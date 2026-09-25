---
'yellow-review': patch
---

Classify `git ls-tree` failures as unverifiable in reconcile deletion
retirement, re-verify and dismissal applicability via `rl_tree_lookup`, so a
partial clone with an offline promisor no longer dismisses or reopens findings
on unreadable trees.
