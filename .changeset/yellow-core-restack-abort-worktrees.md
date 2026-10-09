---
"yellow-core": patch
---

Abort an in-chain rebase in every stack worktree on /worktree:restack --abort. When the provider has lost its record of the paused restack, --abort now keeps state and restores nothing instead of aborting only the paused rebase. A failed per-worktree `git rebase --abort` now prints git's first line, and the exit-31 message names the stuck worktree with the `git -C <path> rebase --abort` fix line. The state file now records each stack branch's pre-restack tip, and --abort also keeps state (exit 31, listing the moved branches) when no rebase is left but a branch tip has moved, such as after finishing the paused rebase with `git rebase --continue`.
