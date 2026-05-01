---
title: 'Anti-patterns and idempotency primitives for Graphite merge queue agents'
date: 2026-04-30
category: code-quality
track: knowledge
problem: Agents interacting with Graphite merge queue have several failure modes — in-queue conflict resolution, force-push while queued, and missing idempotency checks — that silently waste CI or corrupt queue state
tags: [graphite, merge-queue, idempotency, force-push, conflict-resolution, hooks, jsonl, agent-patterns]
components: [merge-queue, gt-workflow, github-actions]
---

## Context

Building a Claude Code plugin that shepherds PRs through Graphite Merge Queue involves several non-obvious failure modes. The patterns below are drawn from the April 2026 research synthesis covering Graphite's documented behavior, GitHub's queue API semantics, and industry agent patterns. They fall into two categories: things that break the queue when an agent does them, and primitives needed for safe multi-session idempotency.

## Anti-Patterns

### Anti-pattern 1: Resolving conflicts while the PR is in the queue

**What goes wrong**: An agent detects a merge conflict on a queued PR and attempts to resolve it by pushing a fix to the PR branch while the speculative build is running.

**Why it breaks**: Graphite's conflict handling model is eject-first. When Graphite detects a conflict it cannot lazy-rebase around, it ejects the PR from the queue, annotates it with a `queue-ejected` label and a comment, and marks it closed with `mergedAt: null`. The agent is not inside the queue working on a live PR — the queue slot no longer exists by the time the agent acts.

Pushing a conflict fix to a queued branch also invalidates the speculative commit SHA (see Anti-pattern 2 below), forcing Graphite to restart CI even if the conflict could have been avoided.

**The correct model**: Conflict resolution belongs *before* queue entry or *after* ejection, never during. The canonical 5-step loop for an agent handling an ejected-with-conflict PR:

1. Apply the conflict fix locally.
2. Run the full test suite against the fixed state.
3. Present the fix to the human via `AskUserQuestion` for approval.
4. On approval: force-push the branch (outside queue — the PR was already ejected).
5. Re-enter the Graphite queue (`gt submit --merge-queue` or via Graphite dashboard).

Steps 1–2 may be agent-autonomous for trivial conflicts (lock files, import order, auto-generated files). Step 3 is always required for any conflict touching business logic, tests, or security-sensitive code.

### Anti-pattern 2: Force-pushing or amending while queued

**What goes wrong**: The agent runs `git commit --amend`, `git push --force`, or `gt modify` on a branch that currently has a live speculative build in the Graphite queue.

**Why it breaks**: Graphite's speculative build is anchored to a specific commit SHA (`speculative_sha`) at the moment of enqueue. Rewriting the branch history produces a new head SHA that no longer matches the speculative commit. Graphite detects the mismatch and restarts CI from scratch, wasting the CI time already consumed. In some cases Graphite may also eject the PR and require manual re-enqueue.

**Mitigation**: Use a PreToolUse hook to detect and block force operations on branches that are currently in shepherd state.

```json
{
  "matcher": "Bash",
  "condition": "tool_input.command matches (--force|--force-with-lease|--amend|--no-verify)",
  "action": "block",
  "message": "[merge-queue] Blocked: history-rewriting operations not permitted while PR is queued. Dequeue first."
}
```

The hook script should cross-reference the command's target branch against the JSONL state file to confirm a shepherd session is active for that PR before blocking. Blocking unconditionally will interfere with unrelated branches.

### Anti-pattern 3: Running both Graphite queue and GitHub native queue

Documented in full in `docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md`. Summary: the two systems must not run simultaneously on the same branch. An agent configuring merge queue behavior must check which system is active before making any changes to branch protection rules.

### Anti-pattern 4: Treating `mergedAt: null` on a closed PR as "not merged"

Documented in full in `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`. Summary: three distinct paths produce `mergedAt: null` + closed state; use `pull_request.merged` (boolean) as the authoritative signal, not `mergedAt`.

## Idempotency Primitives

A merge shepherd agent must be able to restart (session crash, user interrupt, token expiry) and correctly answer: "Am I already in the middle of merging this PR? Has it already merged?"

### JSONL state file shape

Store per-PR state as an append-only JSONL file at a consistent path (e.g., `~/.claude/merge-queue/<repo-slug>/<pr-number>.jsonl`). Append-only preserves audit history across restarts. Each line is a timestamped state transition:

```jsonl
{"ts":"2026-04-30T10:00:00Z","event":"enqueue_requested","pr":123,"repo":"org/repo","idempotency_token":"<uuid>","stack":["#121","#122","#123"],"speculative_sha":null,"step":"awaiting_queue_entry"}
{"ts":"2026-04-30T10:01:00Z","event":"queued","speculative_sha":"abc123","queue_position":3,"step":"monitoring_ci"}
{"ts":"2026-04-30T10:15:00Z","event":"ci_pass","speculative_sha":"abc123","step":"awaiting_merge_confirmation"}
{"ts":"2026-04-30T10:16:00Z","event":"human_approved","actor":"user","step":"merging"}
{"ts":"2026-04-30T10:17:00Z","event":"merged","merged_sha":"def456","step":"complete"}
```

**Required fields per entry**: `ts`, `event`, `pr`, `repo`, `idempotency_token`, `step`.

**Optional fields**: `speculative_sha` (null until Graphite confirms queue entry), `queue_position`, `stack`, `hotfix_branch_ref`, `agent_session_id`, `last_checked_review_id`, `conflict_state`.

On SessionStart, the hook reads the latest entry for any active PR and injects the `step` as a system message so the agent resumes from the correct state rather than starting over.

### The four idempotency rules

**Rule 1 — Check `pull_request.merged` before any merge action.**

Before enqueuing, before posting merge confirmation, before any `gh pr merge` or `gt submit --merge-queue` call:

```bash
MERGED=$(gh api repos/{owner}/{repo}/pulls/{number} --jq '.merged')
if [ "$MERGED" = "true" ]; then
  printf '[merge-queue] PR #%s already merged. Exiting as no-op.\n' "$PR_NUMBER" >&2
  exit 0
fi
```

**Rule 2 — Check `mergeQueueEntry` before enqueuing.**

If the agent restarts after recording `event: enqueue_requested` but before receiving confirmation, the PR may already be in the queue. Before calling `gt submit --merge-queue`, query GraphQL for `mergeQueueEntry` state. If state is `QUEUED` or `AWAITING_CHECKS`, skip the enqueue call and proceed to monitoring.

**Rule 3 — Deduplicate comment posts.**

Before posting a status comment to the PR timeline, store a hash of the comment body in the JSONL state file. On restart, check recent PR timeline comments via `gh api repos/{owner}/{repo}/issues/{number}/comments` and compare. If the comment is already present, skip.

**Rule 4 — Use an idempotency token on API calls.**

Generate a UUID at session start for each PR being shepherded. Pass this token on all Graphite and GitHub API calls that support idempotency keys. Store it in the JSONL state file under `idempotency_token`. On restart, reuse the same token — do not generate a new one for an already-started session.

### Speculative SHA tracking

Record `speculative_sha` as soon as Graphite confirms the PR is in the queue. On every polling cycle while monitoring CI, compare the current PR head SHA against the recorded `speculative_sha`. If they diverge (another actor pushed to the branch), the speculative build is invalidated. The agent should:

1. Log the SHA mismatch.
2. Dequeue the PR (to avoid CI waste on an invalid speculative build).
3. `AskUserQuestion`: "The PR branch was modified by another actor while queued. Speculative build is invalid. Options: [Re-enqueue with new head / Dequeue and wait for manual action / Other]."

## Why This Matters

Merge queue operations are among the most consequential things an agent can do — they directly affect what lands on trunk. A missed idempotency check produces double-merges. An in-queue force-push wastes CI on a project that may have long build times. An agent that silently bypasses these patterns is more dangerous than no automation at all.

## When to Apply

- When implementing the core state machine of a merge shepherd agent
- When writing PreToolUse hooks that gate force operations
- When designing the JSONL state file format for any merge-related plugin
- When writing SessionStart hooks that must resume a shepherd session after a crash
- When reviewing any agent command that calls `gh pr merge`, `gt submit`, or `git push --force`

## Related

- `docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md`
- `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
- `docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md` — SessionStart hook requirements (`{"continue": true}` on all paths, no `set -e`)
- `docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md` — hook input field paths for PreToolUse/PostToolUse
