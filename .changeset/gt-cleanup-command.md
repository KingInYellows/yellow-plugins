---
"gt-workflow": minor
---

Add `/gt-cleanup` command for branch cleanup and divergence reconciliation.
Scans local branches for staleness (orphaned, closed PR, aged out) and
bidirectional divergence (behind/ahead of remote), with category-based cleanup
actions using `gt delete`, `gt get`, and warn-only for unpushed branches.
Complements `/gt-sync` which handles merged branches.
