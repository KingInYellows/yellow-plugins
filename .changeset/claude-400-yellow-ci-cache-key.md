---
'yellow-ci': patch
---

The SessionStart hook no longer prints a false "Cannot start a CI refresh"
warning when a refresh finishes during the marker check. A `--separate-git-dir`
checkout now shares its CI result cache with its worktrees, a set `GH_REPO` is
part of the cache key, a worktree `.git` file is trusted only when its git dir
points back at it, and a different repository re-cloned at the same path no
longer shows the old one's failures.
