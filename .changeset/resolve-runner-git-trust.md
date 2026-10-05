---
'yellow-review': patch
---

`commit-resolve-fixes` and `run-verify-command` refuse a `git`, `gh`, or `jq`
whose canonical file is inside the worktree, and they exec only the absolute
path outside it.
