---
"yellow-core": patch
---

Stop the generated statusline from leaving a stale `.git/index.lock`: its git
segment now runs `git --no-optional-locks status`, so a refresh killed by the
2-second timeout no longer blocks the next commit. The git cache is now keyed
by working directory, so concurrent sessions in different repos or worktrees
no longer show each other's branch. Re-run `/statusline:setup` to pick up the
fix.
