---
'yellow-core': patch
---

`/worktree:restack` no longer drops its restack state on `restore` while a
GitHub restack conflict is still paused. When gh-stack leaves no detached
worktrees, `restore_and_clear` now keeps the state file and the
`gh-stack-rebase-state` marker, marks the lock paused, and exits 40 with a
pointer to `--continue` or `--abort`; `restore` prints the same warning up
front. This restores the guard from #993 that the merge queue's squash missed.
