---
title: 'Sweep runs: resolve review threads one by one, using IDs read from the source'
date: 2026-10-03
category: workflow
track: knowledge
problem: 'Cluster-level thread resolution closes unaddressed threads, and a thread ID mistyped in a resolver prompt goes unnoticed'
tags: [review-sweep, review-resolve, pr-comment-resolver, thread-resolution, graphql, orchestration]
components: [yellow-review]
---

## Context

Point-in-time process note from a `/review:sweep-all` pass over stacked PRs
#950, #952, #954 and #955 plus #984 on main (#952 was skipped because its
worktree held another session's uncommitted edit). It records two behaviours
seen while the orchestrator closed review threads after `pr-comment-resolver`
ran. Re-read `plugins/yellow-review/commands/review/resolve-pr.md` before
relying on either; PR #954 wires per-thread resolver dispositions into that
command and may have changed the first one.

Other observations from the same run are already documented:

- Branch held by another worktree: `docs/solutions/workflow/worktree-batch-pipeline-branch-held-elsewhere.md`
- Upstack restacked locally, not published: `docs/solutions/logic-errors/resolve-stack-state-stale-after-fix-commit-push.md`
- Outdated threads hidden from the re-fetch, `reviewThreads` count: the `count-unresolved-threads-with-graphql` memory entry
- Transient `gh` failures during verification, retry ladders: `docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`
- Docs written by the compounder land untracked in the main clone: `docs/solutions/workflow/background-agent-repo-writes-during-batch.md`

## Guidance

1. **Do not trust cluster-level resolution when a cluster holds more than
   one thread.** At the time of the run, the `/review:resolve` Step 7 marked
   every thread in a cluster resolved unless the resolver emitted a
   `CONFLICT:` line. A resolver that fixed one of two threads and said so in
   prose still got both closed. Resolve per thread, driven by the resolver's
   per-thread report, and leave every thread it did not address open.
2. **Resolve by the ID you read from the source, never the one you relayed.**
   A thread ID was mistyped when copied into a resolver prompt (one trailing
   character differed). Nothing broke only because the orchestrator resolved
   using the ID it had fetched, not the copy in the prompt. Keep the fetched
   list as the single source of IDs, and treat any ID echoed back by a
   resolver as a claim to match against that list.

## Why This Matters

Closing an unaddressed thread removes the merge gate that would have caught
it, and an outdated-thread-hiding fetch means nobody sees it again. A relayed
ID that is wrong by one character would resolve the wrong thread, or none,
with no error to show for it.

## When to Apply

Any unattended or batch pass that resolves threads after dispatching
resolvers: `/review:sweep-all`, `/review:resolve`, ad-hoc orchestration.
After #954 merges, confirm the command's own per-thread behaviour before
keeping the manual step.
