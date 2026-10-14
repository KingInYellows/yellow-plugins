---
"yellow-core": minor
---

`/worktree:restack --abort` now aborts git rebases only in worktrees the run
recorded: the run worktree, Graphite's detached worktrees and, for GitHub, the
worktrees that held a restacked branch at start (newly recorded as `owner` lines
in the state file). A rebase elsewhere is left alone and named. A recorded
worktree whose rebase state cannot be read stops the abort (exit 31) instead of
being treated as clean, and every stuck worktree is named with a fix line. A
worktree deleted during the pause no longer blocks the abort. The run worktree
is not checked out while an operation is in progress there. `status` lists owner,
rebasing, busy, unreadable and unrecorded worktrees.
