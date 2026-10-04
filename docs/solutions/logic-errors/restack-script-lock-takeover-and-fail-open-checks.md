---
title:
  'A Resumable Multi-Worktree Script Needs Provable-Death Lock Takeover and
  Fail-Closed Git Checks'
date: 2026-10-03
category: logic-errors
track: bug
problem:
  'worktree-restack.sh (PR #993) misjudged ancestry mid-stack, raced its lock
  takeover, read failed git calls as clean, and cleared state while a provider
  rebase was still paused'
tags:
  [
    bash,
    lock,
    pid-reuse,
    fail-closed,
    process-substitution,
    exit-codes,
    worktree,
    restack,
    signal-handling,
    bats,
  ]
components:
  [yellow-core, worktree-restack, git-worktree-skill, stack-operation-registry]
---

## Problem

PR #993 added `/worktree:restack`, a script that detaches every worktree in a
stack, runs the enabled provider's restack (Graphite or `gh stack`), and
restores the worktrees. It can pause on a conflict and resume in a later
process, so it keeps a state file and a lock across processes. Several review
rounds (correctness, security, reliability, adversarial, silent-failure,
cli-readiness, test coverage) found one family of bugs: the script decided
"safe" or "done" from evidence that was absent, stale, or from the wrong base.

## Symptoms

- A restack started from a mid-stack branch exited 50 (ancestry failed) even
  when the restack was correct, or passed when it was skipped.
- A second `--continue` could move a live owner's fresh lock; an exited pid that
  was recycled by an unrelated process blocked `--continue`; an EXIT trap
  released the lock while the state file still existed.
- A failing `git status` or `git worktree list` read as "clean" or "no
  worktrees", so restore dropped every entry and deleted the recovery state.
- A non-conflict provider failure while `gh stack` still held its own rebase
  record cleared our state and lock, orphaning the paused rebase.
- `--abort` printed "aborted" and restored worktrees while a rebase was still in
  progress because the provider's pause marker was missing.
- Exit 30 meant both "failed, restored" and "failed, state kept"; with a
  rejected state file, `--status` and `restore` were unusable and the recovery
  lines existed only in an earlier transcript.

## What Didn't Work

- Reclaiming a stale lock by renaming it aside and putting it back: the rename
  can move a live owner's freshly created lock.
- Treating a pid-less lock directory as stale: it is the window between `mkdir`
  and the pid stamp of a live process.
- Trusting `kill -0 "$pid"` on a lock left by an exited process: the pid can
  belong to an unrelated process by the next `--continue`.
- Reading `git status` output through process substitution and checking only the
  loop result: the loop saw zero records when git failed.

## Solution

Fixes are in
`plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh` and the
bats suite beside it.

1. **Seed the ancestry chain with the current branch's parent.** The base is the
   parent of the starting branch (trunk only for the bottom branch), so a run
   started above the bottom still tests the real parent link. Test from a
   mid-stack branch, not only from the bottom.
2. **Take over a lock only from a provably dead owner.** A paused run replaces
   the pid with the word `paused` (a pid cannot be proven dead after the process
   exits, but a marker can). Do the replacement inside an exclusive guard
   directory (`mkdir` is the atomic step), re-check the owner inside the guard,
   and never reclaim a pid-less lock. Release a lock only when its pid file is
   this process's `$$`. An EXIT trap marks the lock paused while the state file
   exists, instead of releasing it.
3. **Emit a sentinel when the git command fails inside the process
   substitution.** `done < <(git ... || printf 'worktree-list-failed\0')` turns
   a command failure into a record the loop can see. Treat the `git status`
   sentinel as dirty and the `worktree list` sentinel as a hard error that keeps
   the state.
4. **Treat the provider's own in-progress marker as a pause** for every step
   except abort. If `gh stack` still has a rebase record, keep state and lock.
5. **Verify after the provider's abort step.** Refuse to report success while
   git still shows a rebase in progress in the run worktree.
6. **Separate exit codes by state outcome.** Exit 30 is "failed, worktrees
   restored (or nothing changed)"; exit 31 is "failed, state kept". On a
   rejected state file, `--status` and `restore` still list stranded and
   pause-locked worktrees with copy-paste checkout and unlock lines.
7. **Drop state nothing reads.** Removing token, tool, per-entry phase and
   lock-flag fields (unlock by comparing the worktree lock reason to the pause
   reason) shrank five parallel arrays and removed fields that could drift.
8. **State deviations from the registry instead of claiming a mirror.** The
   script's provider flags differ on purpose from
   `plugins/yellow-core/lib/stack-operation-registry.js` (scope flags,
   `--no-interactive` on continue, abort `--force`, adapter `--mode`); both
   files now list the differences.

## Why This Works

Every fix replaces an inference with a fact the process can observe: the parent
link from the stack view, a `paused` marker the owner wrote, a sentinel record
from the failing command, and git's own rebase state. A script that resumes in a
different process cannot rely on the pid, the exit status of a pipeline, or the
absence of output.

## Prevention

- For any cross-process lock, ask "what proves the owner is gone?" If the answer
  is only a pid, add a marker written by the owner at pause time. See
  [bash-subshell-pid-rmdir-jq-null-primitives](bash-subshell-pid-rmdir-jq-null-primitives.md)
  for `$$` versus `$BASHPID`.
- A `done < <(cmd)` loop never sees `cmd`'s exit status. Add
  `|| printf '<sentinel>\0'` and handle the sentinel. Related:
  [bash-pipe-head-exit-code-masking](bash-pipe-head-exit-code-masking.md).
- A trap registered at startup must not undo state the next process needs; see
  [trap-cleanup-across-tool-call-boundaries](../code-quality/trap-cleanup-across-tool-call-boundaries.md).
- Give each recovery class its own exit code, and keep recovery lines in the
  output of `--status`, not only in an earlier transcript.
- Test the paths a happy-path suite skips: SIGTERM to the background script
  (assert restore or keep-paused), a forced non-conflict provider failure, a
  hang-on-conflict provider, a mid-stack start, and lock contention at resume.
  The stub knobs for these (sleep, forced failure, hang-on-conflict) live in
  `plugins/yellow-core/skills/git-worktree/tests/mocks/`.
- State file trust limits are documented in
  [shell-owned-state-is-not-a-boundary-against-write](../security-issues/shell-owned-state-is-not-a-boundary-against-write.md).

## Deferred

Three review findings were left open by decision:

- `$ARGUMENTS` is substituted textually into the command's bash fence (an
  existing repo convention, confidence 50).
- Provider calls have no script-side timeout.
- `--status` prints free-form prose instead of tagged lines.
