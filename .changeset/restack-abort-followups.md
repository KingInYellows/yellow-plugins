---
"yellow-core": patch
---

`/worktree:restack --abort` follow-ups from #1197: every exit 31 now ends with a stable `kept: <reason>` token; each cleared worktree rebase is reported, and a partial abort lists the worktrees it already cleared; a refused run-worktree checkout shows git's reason; a rebase started in a detached stack worktree from its recorded commit is aborted with the stack; GitHub runs record an `owners N` count so a run with no owner worktrees is not mistaken for legacy state; `status` names the run worktree's rebase once the provider has lost its record; moved-branch advice asks for `git worktree prune` before `git branch -f` when the branch's holder was deleted; and a legacy run left at phase `aborting` is pointed at `restore` instead of `--continue`.
