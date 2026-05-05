---
title: 'Detecting true merge vs. ejection when a PR is closed with mergedAt: null'
date: 2026-04-30
category: integration-issues
track: knowledge
problem: A PR closed by a merge queue with mergedAt null may have been ejected, not merged — three distinct paths produce this state and require different agent responses
tags: [merge-queue, graphite, github, webhook, mergedat, ejection, graphql, idempotency]
components: [merge-queue, github-actions, gt-workflow]
---

## Context

The project MEMORY.md has carried a one-line observation since an earlier session: "closed PRs with `mergedAt: null` may still be merged." The April 2026 research on Graphite and GitHub native merge queues confirms and explains this observation, adding three distinct causal paths and a reliable detection pattern.

The failure mode for an agent: a PR is closed, `mergedAt` is null, and the agent concludes "this PR was not merged." That conclusion is wrong in some paths (the PR may have been merged via queue with a delay in GitHub's state propagation) and correct in others (the PR was genuinely ejected). Treating ejection as merge, or merge as ejection, produces double-merge attempts or abandoned PRs that were actually shipped.

## The Three Paths

### Path 1: Queue ejection (most common)

**What happens**: PR fails CI during speculative build, or has a merge conflict that lazy rebase cannot auto-resolve. Graphite (or GitHub native queue) ejects the PR.

**Observable state on GitHub**:
- PR status: closed (or open-but-dequeued, depending on Graphite version)
- `mergedAt`: null
- `merged`: false
- Graphite adds a `queue-ejected` label and a PR comment describing the reason
- `pull_request.dequeued` webhook fires (GitHub native queue)

**What the agent must do**: Treat as NOT merged. Author must resolve the conflict or fix CI, then re-enter the queue.

### Path 2: `merge_group.destroyed` without merge

**What happens**: GitHub creates a temporary `gh-readonly-queue/<base>/pr-<number>-<hash>` branch for the speculative build. The merge group lifecycle ends before merge (invalidated due to a new commit on `main`, a CI timeout, or manual dequeue).

**Observable state**:
- `merge_group` webhook fires with `action: destroyed`
- PR is not merged; `mergedAt`: null
- The `gh-readonly-queue/*` branch is deleted

**What the agent must do**: `merge_group.destroyed` alone is not a signal of PR ejection — it is a signal that a specific speculative build attempt ended. The PR may still be in the queue under a new speculative build. Do not dequeue or mark as failed based on `merge_group.destroyed` alone. Correlate with PR state.

### Path 3: Timeline noise from queue branches

**What happens**: The `gh-readonly-queue/*` branch commits appear in the PR's commit timeline. These look like merge activity but are not actual merges of the PR.

**Observable state**:
- PR timeline shows commits referencing `gh-readonly-queue/*` refs
- PR status may be open
- `mergedAt`: null (correctly — the PR has not merged yet)

**What the agent must do**: Ignore timeline activity on `gh-readonly-queue/*` branches entirely as a merge signal. These are speculative build artifacts.

## Detection Pattern

Never use `mergedAt` alone, `merge_group` events alone, or timeline activity alone as ground truth for merge status.

**The reliable detection stack (in order of authority):**

1. **`pull_request.merged` (boolean)** — the authoritative merge flag on the PR object. If `true`, the PR merged. If `false`, it did not, regardless of what `mergedAt` says.

2. **GraphQL `mergeQueueEntry` state** — for current queue position. Use this to determine if the PR is still queued (not yet resolved), was ejected, or was merged.

```graphql
query GetMergeQueueEntry($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      merged
      mergedAt
      state
      mergeQueueEntry {
        state
        position
        enqueuedAt
      }
    }
  }
}
```

`mergeQueueEntry` states: `AWAITING_CHECKS`, `MERGEABLE`, `UNMERGEABLE`, `QUEUED`. A null `mergeQueueEntry` on a closed PR means the PR is no longer in the queue (either merged or ejected — disambiguate via `merged`).

3. **Graphite-specific signals** (when using Graphite Merge Queue):
   - `queue-ejected` label on the PR: ejected, not merged
   - Graphite comment on the PR explaining ejection reason
   - These are present only when Graphite performed the ejection

4. **Webhook subscription** — subscribe to both `pull_request.dequeued` (ejection from GitHub native queue) and `merge_group.destroyed` (speculative build invalidated) for ejection detection. Do not rely on either alone.

**Decision table for a closed PR:**

| `merged` field | `mergedAt` | `mergeQueueEntry` | `queue-ejected` label | Conclusion |
|---|---|---|---|---|
| `true` | non-null timestamp | null (no longer queued) | absent | Merged — mark complete |
| `true` | null (rare, propagation lag) | null | absent | Merged — verify with `merged` field, not `mergedAt` |
| `false` | null | null | present | Ejected by Graphite — requires author action |
| `false` | null | null | absent | Ejected by GitHub native queue, or closed externally — check `pull_request.dequeued` webhook history |
| `false` | null | `UNMERGEABLE` | either | Currently blocked in queue — not yet resolved |

## Idempotency Rule

**Before any merge action** in an agent: call the GitHub API and check `pull_request.merged`. If `true`, log and exit as a no-op. Never attempt to merge an already-merged PR.

```bash
MERGED=$(gh api repos/{owner}/{repo}/pulls/{number} --jq '.merged')
if [ "$MERGED" = "true" ]; then
  printf '[merge-queue] PR #%s already merged. No action taken.\n' "$PR_NUMBER" >&2
  exit 0
fi
```

This check must run before enqueuing, before posting merge confirmation, and before any `gh pr merge` or `gt submit --merge-queue` call. It guards against double-merge in multi-session or restart scenarios.

## Why This Matters

Agents monitoring merge queues are stateful across sessions. A session crash between "enqueue requested" and "merge confirmed" leaves the agent uncertain about final state on restart. `mergedAt: null` on a closed PR is the exact ambiguous state that restoring agents encounter. Without the 3-path model and the `pull_request.merged` anchor, agents either skip cleanup of already-merged PRs or retry merges that already landed.

## When to Apply

- When building any agent that interacts with GitHub or Graphite merge queues
- When writing SessionStart hooks that reload merge state from a JSONL file
- When implementing ejection detection logic in a merge shepherd command
- When diagnosing why an agent treated a merged PR as ejected (or vice versa)

## Related

- `docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md` — architectural context for why Graphite and GitHub native queues produce different ejection signals
- `docs/solutions/code-quality/graphite-merge-queue-agent-anti-patterns.md` — idempotency primitives and state persistence patterns
