# Graphite, Stacked PRs, and Merge Queue — Comprehensive Research Report

**Date:** 2026-04-30
**Sources used:** EXA Deep Researcher (exa-research-pro), Tavily Research (pro, two queries), graphite.dev/docs, docs.github.com, code.claude.com/docs, engineering blogs

---

## 1. Executive Summary

**Key findings:**

- **Graphite is a stack-first platform**: its merge queue is the only major queue that treats a *stack of dependent PRs* as the atomic unit — bottom-of-stack PRs auto-enqueue when any stack member is queued, and speculative builds validate the entire stack's combined diff. This is architecturally incompatible with GitHub's native merge queue and the two must not run simultaneously on the same branch.
- **Graphite Merge Queue lifecycle**: enqueue → lazy rebase → batch draft-PR creation → parallel/speculative CI → fast-forward trunk if green; if CI fails, automated bisection isolates the offending PR, ejects it with a comment, and re-queues the remaining passing set.
- **Conflict ejection, not auto-resolve**: Graphite ejects conflicted PRs (marking them closed with `mergedAt: null` on GitHub), annotates with a `queue-ejected` label and comment, and requires author action (`gt sync` to rebase) before re-entry. Agents that attempt in-queue conflict resolution are working *outside* Graphite's model.
- **GitHub native merge queue is complementary context, not a replacement**: the `merge_group` webhook event (actions: `checks_requested`, `destroyed`) is GitHub's mechanism; Graphite builds its own layer on top and explicitly documents incompatibility.
- **Coding agents in 2026 universally require human-in-the-loop for merge**: Devin, Cursor, Claude Code GitHub Actions, and OpenAI Codex all insert an explicit human approval step before final merge. No major agent platform auto-merges without a checkpoint as of April 2026.

**Recommended plugin shape for `merge-queue`:**
- A Claude Code plugin with one command (`/merge-queue:shepherd <PR-URL-or-number>`), one agent (`merge-queue-shepherd`), two hooks (PreToolUse gate on `gh pr merge`, PostToolUse audit logger), and a JSONL state file per PR tracking: PR ID, queue position, last-seen comment ID, speculative commit SHA, conflict state, idempotency token, hotfix branch refs.
- Human checkpoints required at: (a) initial enqueue confirmation, (b) conflict detected (never auto-resolve non-trivial conflicts), (c) new `request changes` review comment detected mid-queue, (d) CI bisection ejects the PR.

---

## 2. Graphite Platform Model

### Stacked Diffs / Stacked PRs

Graphite's core thesis is that large changes should be decomposed into a series of incremental PRs, each a logical parent of the next. Each stack element is a Git branch parented to the one below it. Graphite's CLI tracks these parent/child relationships via local metadata — it does not embed this in Git itself, so stacks are Graphite-aware objects layered on top of standard Git.

The web UI renders stacks as a dependency map, showing which PRs must land before others can be reviewed or merged. GitHub only sees independent PRs pointing at different base branches.

### Key `gt` CLI Commands

| Command | What it does |
|---|---|
| `gt create [name]` | Creates a new branch on top of current, commits staged changes. `--ai` flag for AI-generated branch names, `-p` for interactive hunk selection, `-i` to insert between existing children. |
| `gt modify` | Amends the current branch. Interactively suggests hunk boundaries and restacks all descendants after amendment. |
| `gt submit` | Submits branches as PRs to GitHub, preserving dependency order. Each PR's base is set to its parent branch. By default submits all branches upstack of the current position. |
| `gt restack` | Recomputes parent/child ancestry relationships after manual Git operations or rebases. Run this when `gt` metadata and Git tree have diverged. |
| `gt sync` | Synchronizes local branches with remote, rebases upstack branches onto the updated trunk after merges land. This is the primary tool for keeping a stack current after other PRs merge. |
| `gt absorb` | Automatically integrates staged changes into the most relevant existing commit in the stack — minimizes manual rebase overhead for small fixups. |

### Stack Model: Parent/Child Branches

- Every branch in a stack has at most one parent (downstack) and may have multiple children (upstack).
- `gt bottom` / `gt top` navigate the chain.
- Collaborators can fetch and freeze specific branches to prevent unintended edits on shared stacks.
- Graphite stores metadata separately from Git — it is not embedded in commit messages or trailers.

### Rebase vs. Merge

Graphite defaults to rebasing for all stack integration. Merge commits only appear if conflicts arise that cannot be fast-forwarded. `gt sync` rebases each branch onto the latest trunk after PRs land. This produces clean linear history on trunk.

### Trunk Model

Graphite uses a single-trunk model (`main` or `master`). Feature stacks branch off trunk and are expected to return to trunk frequently. Long-lived diverging branches are an anti-pattern in the Graphite model.

---

## 3. Graphite Merge Queue — Deep Dive

### End-to-End Lifecycle

1. **Enqueue**: Developer opts in a PR (or entire stack) via the Graphite dashboard or `gt submit --merge-queue`. Graphite validates prerequisites: passing CI checks, required approvals, conversation resolution if branch protection requires it.
2. **Lazy rebase**: Graphite rebases only the conflicted PRs in a stack — if a stack has `m` merge conflicts, Graphite performs exactly `m` rebases, not a full-stack rebase. This is explicitly documented as "lazy rebasing" and is one of Graphite's key efficiency claims.
3. **Batch formation**: Graphite groups multiple PRs into batches, either by time window (configurable, default ~5 minutes) or PR-count limit (configurable, default ~5 PRs). Batch sizing and concurrency are exposed in the Graphite app settings UI.
4. **Speculative build**: For each batch, Graphite creates a draft/synthetic merge commit representing `trunk + all batch PRs` in stack order. CI runs against this combined state. This is the "speculative" or "optimistic" check — CI validates the future merged state, not the PR branch alone.
5. **Parallel CI optimization**: Graphite can run CI on every stack in a batch in parallel ("full parallel isolation" default) to quickly surface failing stacks, or use bisection to efficiently locate failures with fewer runs.
6. **Merge**: If CI passes on the speculative commit, Graphite fast-forwards trunk to the batch head. Multiple PRs merge in a single operation. Merge methods: Squash, Rebase, or Merge Commit — configurable per repository.
7. **Dequeue and sync**: Merged PRs are marked merged. Dependent upstack branches are rebased via `gt sync`.

### Required CI Checks and "Ready" Detection

Graphite requires:
- Status checks passing on the PR branch (pre-queue gate).
- Required approvals per branch protection rules.
- Conversation resolution if configured.
- The Graphite GitHub App must be installed and listed as an authorized bypass actor in branch protection rules.

Graphite recommends adding a Graphite CI optimizer step (with a Graphite token) to GitHub Actions workflows, plus a `wait` step early in the workflow. This lets Graphite conditionally skip downstream CI on upstack branches to avoid "missing required CI" errors — a known gotcha when branch protection requires CI on all base branches.

**Known limitation**: Graphite does not support GitHub deployment checks in branch protection rules.

### Batching Strategy and Failure Recovery

When a speculative build fails:
1. Graphite automatically bisects the batch — runs CI on progressively smaller subsets.
2. Identifies the offending PR(s).
3. Ejects the failing PR from the queue.
4. Re-queues the passing set automatically.
5. Notifies the failing PR's author via GitHub PR comment and Graphite dashboard.

### Stacked PR Merge Queue Behavior

This is the key behavioral difference from GitHub's native queue:
- When any PR in a stack is enqueued, Graphite enqueues all ancestors (downstack PRs) to preserve dependencies.
- Speculative builds merge the full stack's combined diff.
- Bottom-of-stack PRs do not need to manually land before top-of-stack PRs — Graphite handles the ordering.
- If a parent PR's queue position changes (e.g., ejected), dependent upstack PRs are also affected.

### Conflict Handling

- Graphite uses lazy rebasing to minimize scope.
- If a conflict cannot be automatically resolved, Graphite ejects the PR from the queue.
- The ejected PR is marked closed on GitHub with `mergedAt: null`.
- Graphite annotates with a `queue-ejected` label and a PR comment explaining the conflict.
- Author must run `gt sync` locally to rebase and resolve conflicts, then re-submit to the queue.
- **Agents cannot resolve conflicts in-queue** — this happens before or after queue entry, not during.

### Speculative / Optimistic Checks vs. Strict Rebuilds (as of 2026)

Graphite's documented behavior as of April 2026:
- Default: Full parallel isolation (run CI on all stacks in a batch concurrently).
- Alternative: Bisection mode (progressively smaller subsets) for CI cost optimization.
- No strict sequential rebuild is documented as default — Graphite leans optimistic.
- If a commit lands on `main` outside Graphite while PRs are queued, Graphite restarts CI on queued commits against the new base. This is documented operational behavior teams must account for.

### Graphite vs. GitHub Native Merge Queue

| Dimension | Graphite Merge Queue | GitHub Native Merge Queue |
|---|---|---|
| Stack awareness | Yes — first-class | No — enqueues individual PRs |
| Speculative batching | Yes — draft PRs | Yes — `gh-readonly-queue/*` branches |
| Bisection on failure | Yes | No — ejects head entry only |
| Conflict handling | Lazy rebase + eject | Eject |
| API surface | REST under `/merge-queue` namespace (vendor docs) | GraphQL (`enqueuePullRequest`, `dequeuePullRequest`, `mergeQueueEntry`), webhooks |
| Compatibility | **Incompatible with GitHub native queue** | Native GitHub feature |
| CI optimizer | Graphite CI optimizer step (GH Actions) | `merge_group` trigger in workflows |

**Critical**: Graphite docs explicitly state the two systems are incompatible. Disable GitHub's native merge queue when using Graphite.

### Merge Methods

- **Squash**: All PR commits become one commit on trunk.
- **Rebase**: PR commits rebased onto trunk individually.
- **Merge commit**: Full PR history preserved with a merge commit.
- Fast-forward mode is available when parallel processing of stacked PRs is enabled.
- Defaults are configurable at repository level in the Graphite app.

### Graphite APIs for Programmatic Queue Management

- REST API under `/merge-queue` namespace (Graphite developer portal — exact endpoint reference not publicly indexed as of research date).
- CLI: `gt submit --merge-queue` for queue entry.
- Graphite exposes queue position, draft commit SHAs, and merge activity in the dashboard UI.
- For webhook/event payloads, Graphite docs reference a "merge activity timeline" as the primary observable surface but do not publish a complete webhook schema in public docs. **This is an evidence gap** — teams should validate actual Graphite webhook payloads via Graphite support or controlled testing.

---

## 4. GitHub Native Merge Queue Reference

### The `merge_group` Webhook Event

GitHub creates temporary branches prefixed `gh-readonly-queue/<base>/pr-<number>-<hash>` that represent `trunk + queued PR(s)`. It dispatches `merge_group` webhook events when creating these branches.

**Key payload fields** (from `checks_requested` action):
```json
{
  "action": "checks_requested",
  "merge_group": {
    "base_ref": "refs/heads/main",
    "base_sha": "<sha>",
    "head_ref": "refs/heads/gh-readonly-queue/main/pr-123-abc123",
    "head_sha": "<speculative-commit-sha>",
    "head_commit": {
      "id": "<sha>",
      "message": "Merge pull request #123...",
      "timestamp": "2026-04-30T18:00:00Z",
      "author": { "name": "...", "email": "..." },
      "committer": { "name": "GitHub", "email": "noreply@github.com" },
      "tree_id": "<tree-sha>"
    }
  },
  "repository": {},
  "sender": {},
  "organization": {},
  "installation": {}
}
```

**Action values**: `checks_requested` (documented original), `destroyed` (added in July 2023 GA changelog). There is a documented divergence between the original webhook reference and the changelog — treat both as valid. Do not rely on `head_ref` format for parsing PR numbers; it is not a stable contract.

**Required GitHub App permission** to receive `merge_group` events: read-level "Merge queues" repository permission.

### GitHub Actions `merge_group` Trigger

CI workflows must include `on: merge_group` to report checks for queue commits. Without this, required checks are not satisfied and PRs stall. Actions running on `merge_group` automatically create check runs for `merge_group.head_sha` as part of the normal job lifecycle.

```yaml
on:
  merge_group:
  pull_request:
```

### Auto-merge vs. Merge Queue — Semantic Difference

| | Auto-merge | Merge queue |
|---|---|---|
| Scope | Single PR | Multiple PRs coordinated |
| Speculative commit | No | Yes (`gh-readonly-queue/*` branch) |
| Ordering | N/A | FIFO |
| Batching | No | Yes (grouping strategies) |
| When to use | Simple single-PR flow | High-velocity repos needing ordering + CI efficiency |

Auto-merge gates a PR on its *own* checks/approvals. Merge queue validates a *combined future state* of multiple PRs. Enabling auto-merge requires write access; it is automatically disabled if a non-author with write access pushes new changes.

### Branch Protection Rules Affecting Queue Behavior

- "Require status checks to pass before merging" must be enabled.
- The merge queue must be selected as a required check.
- Grouping strategy (`ALLGREEN` vs. `HEADGREEN`) controls whether all PRs' checks must pass individually or only the head-of-queue.
- `max_entries_to_build`, `max_entries_to_merge`, `min_entries_to_merge`, `check_response_timeout_minutes` are REST-accessible rule parameters.
- Branch protection restricts who can push, force-push, or create matching branches.

### Closed PR with `mergedAt: null` After Queue Ejection

This is a confirmed behavior pattern with multiple documented paths:

1. **Queue ejection (most common)**: PR fails CI in queue → `pull_request.dequeued` webhook fires → GitHub closes the PR (or it remains open-but-dequeued) → if the PR was previously closed by the ejection workflow, `merged_at` remains `null` because no merge occurred. Graphite annotates with `queue-ejected` label and comment.

2. **`merge_group.destroyed` without merge**: The merge group lifecycle ends (invalidated, not merged) → `merge_group` event with `action: destroyed` → PR is not merged → `merged_at: null`.

3. **Timeline noise**: Queue-created preparation branch commits appear in the PR timeline but are not actual merges. Do not interpret timeline activity on `gh-readonly-queue/*` branches as merge confirmation.

**Detection pattern**: Never use `merge_group` events alone as ground truth for merge status. Always correlate with `pull_request.merged == true` (boolean field on the PR object). Subscribe to both `pull_request.dequeued` and `merge_group.destroyed` for ejection detection. Use GraphQL `mergeQueueEntry` state for authoritative queue position queries.

**Agent implication**: An agent that checks `mergedAt` on a closed PR must treat `mergedAt: null` + closed state as potentially-ejected-not-merged, not as "this PR was merged via queue." The project MEMORY.md already documents this observation — this research confirms it.

---

## 5. Coding Agent Merge Patterns — April 2026

### Industry Survey

As of April 2026, every major AI coding agent platform enforces a human checkpoint before merge:

- **Claude Code GitHub Actions**: Runs automation on PR events with `@claude` interactions. Supports `CLAUDE.md` for encoding project standards. Does not auto-merge without explicit workflow configuration. Routines support `merge_queue`, `check_run`, `pull_request.*` triggers.
- **Devin**: Provides "Devin Review" UI with explicit Merge/Close/Auto-merge controls visible to human reviewers. Devin can fix issues and create PRs but recommends human verification before merge. Devin's automation templates (issue-fix workflow) always surface for human sign-off before final submission.
- **Cursor Automations**: Runs agent jobs on GitHub events/schedules but does not auto-merge without human trigger in documented flows.
- **OpenAI Codex Action**: Runs on PR events, posts review comments, does not auto-merge. Hardened against command injection in runner steps.

**Consensus position**: No major agent platform auto-merges without a human checkpoint in April 2026. This is a design choice, not a capability gap.

### Human-in-the-Loop (HITL) Boundaries

**Must require human confirmation** (industry consensus):
- Initial queue entry decision ("I will merge this PR — are you sure?")
- Any detected semantic conflict (files touched by both the PR and a concurrent landing)
- New `request changes` review from a required reviewer while PR is queued
- CI bisection ejects the PR — the agent must not silently re-enter the queue
- Hotfix prioritization that reorders the queue
- Any automated code change the agent applies to resolve a conflict

**May be agent-autonomous** (with audit trail):
- Polling queue position
- Re-triggering CI on a draft branch
- Posting status comments to the PR timeline
- Detecting and logging new review comments (detection only, not response)
- `gt sync` + rebase when no conflicts exist (trivial rebase)

### Conflict Resolution Safety

**Trivial (agent-safe)**:
- Merge conflicts in generated files (lock files, auto-generated code)
- Line-number-only conflicts with no semantic overlap
- Import order conflicts where the merge is mechanical

**Semantic (requires human)**:
- Conflicts in business logic files
- Conflicts in tests (the test may be testing behavior that changed)
- Conflicts in security-sensitive code (auth, crypto, permissions)
- Any conflict the agent cannot deterministically resolve with 100% confidence

**Industry position (April 2026)**: Agents should attempt trivial conflict resolution only, run tests against the result, and escalate to human if tests fail. Graphite's lazy rebase model means conflict resolution happens *before* or *after* queue entry — not during. An agent resolving a conflict should: (1) apply fix locally, (2) run full test suite, (3) AskUserQuestion for approval, (4) force-push the branch, (5) re-enter queue. This is the canonical 5-step loop.

### Picking Up New Review Comments Mid-Queue

This is the hardest problem in agent merge management. The failure mode is:

1. Agent enqueues PR.
2. Reviewer posts `request changes` while PR is in speculative build phase.
3. Agent doesn't detect it.
4. Graphite merges the PR.
5. Reviewer's feedback is ignored.

**Recommended pattern**:
- Poll `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` on a cadence (every 60-120 seconds while queued).
- Track `last_seen_review_id` in persistent state.
- On any new review with `state: CHANGES_REQUESTED`:
  - Immediately call Graphite to dequeue the PR (or eject via Graphite dashboard API).
  - Post a comment noting the dequeue reason.
  - AskUserQuestion: "New `request changes` review from @{reviewer}. Options: [Dequeue and fix / Continue and resolve later / Escalate to maintainer]."
- Non-blocking comments (type `COMMENTED`, not `CHANGES_REQUESTED`): agent may log and continue, with the comment noted in the audit trail.
- On `APPROVED` from a new required reviewer: no action needed, PR gains approval.

### Hotfix Patterns

When a queued PR's CI breaks due to a parallel landing on `main`:

1. Graphite restarts CI on queued commits against new `main`. The agent should detect this (queue status change) and not panic.
2. If CI still passes after the restart: no action needed, proceed.
3. If CI fails after the restart (a genuine breakage from the parallel landing):
   - AskUserQuestion: "CI failed after a new commit landed on main. Options: [Dequeue and rebase / Create hotfix branch / Escalate]."
   - If "Create hotfix branch": agent creates `hotfix/<pr-number>-<timestamp>`, cherry-picks the fix, submits as a new PR, and marks it for fast-track in Graphite.
   - If "Dequeue and rebase": `gt sync` + `gt restack` + re-submit.

**Graphite fast-track**: Mark a single urgent PR for fast-track via Graphite UI/API to move it to queue head while still running full CI and rebase. This is the safe alternative to force-merging outside the queue.

**Anti-pattern**: Pausing the queue to inject a hotfix then resuming is tempting but risky — it serializes all other work. Fast-track is preferred.

### Idempotency and Re-Entry Across Sessions

An agent must be able to restart and answer: "Am I already in the middle of merging this PR?"

**State to persist** (per PR, in a JSONL file):
```
pr_id, pr_number, repo, queue_entry_time, speculative_commit_sha,
last_checked_review_id, conflict_state, idempotency_token,
hotfix_branch_ref, agent_session_id, state_machine_step
```

**Idempotency rules**:
- Before any merge action: check `pull_request.merged` via API. If already merged, mark as complete and exit — do not merge again.
- Before enqueuing: check `mergeQueueEntry` state via GraphQL. If already queued, skip enqueue call.
- Before posting a comment: store the comment body hash in state. If already posted (check recent PR timeline), skip.
- Use `idempotency_token` (UUID generated at session start for this PR) on all Graphite/GitHub API calls that support it.

### Anti-Patterns

| Anti-pattern | Why it breaks queue | Mitigation |
|---|---|---|
| Force-push to PR while queued | Invalidates speculative commit SHA, wastes CI | Detect head-ref change for enqueued PRs; dequeue before any force-push |
| `git commit --amend` after queue entry | Same as force-push — rewrites history | Lock the branch when queued (PreToolUse hook to block amend commands) |
| `--no-verify` bypass | Skips local hooks, may land code that fails remote CI | PreToolUse hook blocking `--no-verify` on any commit while queued |
| Running both Graphite queue and GitHub native queue | Out-of-order merges, CI restarts | Disable GitHub native queue when Graphite is active |
| Merging base branches directly outside Graphite | Causes Graphite to restart CI on all queued commits | Enforce all `main` writes go through Graphite queue |
| Auto-resolving semantic conflicts | Risk of shipping broken logic | Escalate all non-trivial conflicts to human checkpoint |

---

## 6. Claude Code Integration Patterns

### Existing Plugins (April 2026)

The Claude Code plugin marketplace and community catalog include (as of research date):

- **`composiohq/create-pr`**: Automates branch creation, formatting, commit staging, and PR submission to GitHub.
- **`code-review` (official Anthropic)**: Runs multiple sub-agents for review scoring, posts comments.
- **`github-pr-auto-fix-merge` (community)**: Auto-fixes minor issues in PRs and enters merge queues.
- **`enter-merge-queue` (community skill)**: Skill for queue entry with rebase, CI monitoring, mergeability checking.
- **`gt-workflow` (user's existing plugin)**: Handles the create/submit side of the Graphite workflow.

**Gap**: No existing plugin handles the full shepherd loop (enqueue → monitor → conflict-detect → hotfix → merge confirmation). This is the gap the `merge-queue` plugin fills.

### Hook Patterns for Merge Operations

**PreToolUse hook** — use to gate dangerous operations:
```json
{
  "matcher": "Bash",
  "condition": "tool_input.command matches (--no-verify|--force|--force-with-lease)",
  "action": "block",
  "message": "[merge-queue] Blocked: force operations not permitted while PR is queued"
}
```

**PostToolUse hook** — use for audit logging (cannot undo, only observe):
```json
{
  "matcher": "Bash",
  "condition": "tool_input.command matches (gh pr merge|gt submit)",
  "action": "run",
  "command": "./hooks/scripts/post-merge-audit.sh"
}
```

The audit script should log: PR number, commit SHA, actor, timestamp, idempotency token, queue position at time of merge.

**SessionStart hook** — load current PR state from the JSONL state file so the agent can resume mid-session:
```bash
# Load state, output {"continue": true, "systemMessage": "Resuming merge shepherd for PR #123 at step: awaiting_ci"}
```

Critical: SessionStart hooks must output `{"continue": true}` on all code paths. Do not use `set -e` in hook scripts that must emit JSON. See project MEMORY.md for established patterns.

### AskUserQuestion Checkpoints

Per established project patterns, the `Other` button is the only AskUserQuestion button that opens free-text input. Use it for "provide conflict resolution guidance" cases.

**Example merge confirmation checkpoint**:
```
AskUserQuestion({
  question: "Ready to enqueue PR #123 (Stack: feat/auth → feat/auth-tests → feat/auth-docs). CI is green. Merge strategy: squash. Approve?",
  options: ["Enqueue now", "Review diff first", "Defer — notify me later", "Other"]
})
```

**Example conflict checkpoint**:
```
AskUserQuestion({
  question: "PR #123 was ejected from queue due to merge conflict in src/auth/session.ts. How should I proceed?",
  options: ["Auto-rebase (no conflicts detected on re-check)", "I'll fix manually — notify me when ready", "Abandon merge attempt", "Other"]
})
```

### Agent Identity for Queue Operations

- Use a dedicated GitHub App (not a personal token) as the merge actor. GitHub Apps can be granted narrow "Merge queues" read permission + "Pull requests" write permission.
- The Graphite GitHub App must be listed as an authorized bypass actor in branch protection rules.
- Signed commits: configure the GitHub App to sign commits. This provides auditability of which commits the agent created vs. human commits.
- **Minimum GitHub scopes** for the merge-queue plugin's service account:
  - `repo` (PR read/write, status checks)
  - `merge-queues:read` (via GitHub App permission, not OAuth scope)
  - No `admin:org`, no `delete_repo`
- **Graphite token**: Graphite exposes API tokens per user/org. The exact token scopes are not publicly documented in Graphite's API reference as of April 2026 — **this is a confirmed evidence gap** requiring direct Graphite support consultation.

---

## 7. Plugin Design Recommendations

### State Model

Store per-PR state as a JSONL file at `~/.claude/merge-queue/<repo>/<pr-number>.jsonl` (append-only for audit trail). Each entry is a timestamped state transition:

```jsonl
{"ts":"2026-04-30T10:00:00Z","event":"enqueue_requested","pr":123,"repo":"org/repo","idempotency_token":"uuid","stack":["#121","#122","#123"],"speculative_sha":null,"step":"awaiting_queue_entry"}
{"ts":"2026-04-30T10:01:00Z","event":"queued","speculative_sha":"abc123","queue_position":3,"step":"monitoring_ci"}
{"ts":"2026-04-30T10:15:00Z","event":"ci_pass","speculative_sha":"abc123","step":"awaiting_merge_confirmation"}
{"ts":"2026-04-30T10:16:00Z","event":"human_approved","actor":"user","step":"merging"}
{"ts":"2026-04-30T10:17:00Z","event":"merged","merged_sha":"def456","step":"complete"}
```

### Commands / Agents / Hooks Shape

**Commands:**
- `/merge-queue:shepherd <PR>` — main entry point; shepherds a PR through the full merge lifecycle
- `/merge-queue:status <PR>` — check current queue state and agent step for a PR
- `/merge-queue:dequeue <PR>` — safely dequeue with reason
- `/merge-queue:hotfix <PR> <description>` — inject a hotfix for a currently-queued PR

**Agents:**
- `merge-queue-shepherd` — the core agent; owns the state machine (Observing → Validating → HumanCheckpoint → Queued → MonitoringCI → MergeConfirmation → Merging → PostMergeAudit → Complete/Ejected)
- `merge-queue-conflict-analyzer` — invoked when Graphite ejects for conflict; analyzes the conflict and presents options
- `merge-queue-review-monitor` — background polling agent; detects new review comments and wakes the shepherd

**Hooks:**
- PreToolUse: block force-push / `--no-verify` / `gh pr merge --bypass` while any PR is in shepherd state
- PostToolUse: audit log any `gh pr merge` or `gt submit` call
- SessionStart: load active shepherd state from JSONL; inject as system message

### Failure-Mode Matrix

| Failure Mode | Detection | Response |
|---|---|---|
| Queue ejection (CI failure) | Graphite comment + PR status change | AskUserQuestion → dequeue or fix loop |
| Queue ejection (conflict) | `mergedAt: null` + closed state + `queue-ejected` label | AskUserQuestion → conflict analyzer agent |
| New `request changes` mid-queue | Poll PR reviews API, compare `last_seen_review_id` | Immediate dequeue + AskUserQuestion |
| PR closed externally | Poll PR state; detect `closed` + `mergedAt: null` without agent action | Log + AskUserQuestion: "PR was closed externally. Archive shepherd?" |
| Force-push by another actor | Poll PR head SHA; detect SHA mismatch vs. `speculative_sha` | Dequeue + notify |
| CI flake (retry-able) | Graphite bisection report | If isolated PR passes on second run, re-queue (max 3 retries, then human checkpoint) |
| Graphite queue paused | Graphite UI state | Log + notify; resume when queue unpaused |
| `main` advanced while queued | CI restart by Graphite | Wait for new CI result; escalate if fails |
| Agent session crashed mid-merge | SessionStart loads JSONL state | Resume from last recorded step |
| Double-merge attempt | `pull_request.merged == true` check at start | Exit as no-op; log |

### Permissions Model

| Credential | Required Scopes | Where Stored |
|---|---|---|
| GitHub App / PAT | `repo`, `merge-queues` read (App permission) | Claude Code plugin `userConfig` secret |
| Graphite API token | TBD — consult Graphite support | Claude Code plugin `userConfig` secret |
| CI webhook secret (if polling) | N/A (polling via GH API) | N/A |

Never echo credential values in logs. Use `plugin.json` `userConfig` for all secrets. Rotate tokens on a schedule; prefer GitHub App installation tokens (short-lived) over long-lived PATs.

### Human Approval Points

| Action | Human Required? | Why |
|---|---|---|
| Initial enqueue | Yes (AskUserQuestion) | Irreversible entry into merge pipeline |
| Trivial rebase (no conflicts) | No | Deterministic, reversible |
| Conflict resolution (any) | Yes (AskUserQuestion) | Risk of semantic breakage |
| New `request changes` response | Yes (AskUserQuestion) | Reviewer intent must be respected |
| Hotfix fast-track injection | Yes (AskUserQuestion) | Queue reordering affects all PRs |
| Final merge (after CI green) | Yes (AskUserQuestion) — recommended | Irreversible; policy decision |
| Post-merge audit log | No | Observation only |

### MVP vs. Follow-Up

**MVP (v1)**:
- `/merge-queue:shepherd` command with the core state machine
- AskUserQuestion at enqueue + merge confirmation
- Ejection detection (poll PR state + Graphite comment)
- JSONL state file for idempotency
- PreToolUse hook blocking force-push while queued
- PostToolUse hook for audit logging

**Follow-up (v2)**:
- Background review monitor (continuous polling or webhook-driven)
- Conflict analyzer agent with auto-suggest (but not auto-apply)
- Hotfix injection command
- Stack-aware enqueue (enqueue whole stack, not single PR)
- CI flake detection with auto-retry (bounded)
- Graphite queue pause/resume integration
- Metrics: time-in-queue, CI pass rate, conflict rate per PR

---

## 8. Open Questions / Decisions for the User

1. **Graphite API token scopes**: Graphite's API token reference is not publicly documented at the level of detail needed. You must consult Graphite support or the developer portal to confirm which token type (user token vs. org token vs. service account token) is required for programmatic queue management, and whether enqueue/dequeue can be done via API without dashboard interaction.

2. **Graphite webhook events**: Graphite's internal event/webhook schema is not publicly indexed. Confirm whether Graphite emits webhooks your plugin can subscribe to (e.g., "PR ejected," "queue position changed," "batch merged"), or whether the plugin must poll the Graphite API and GitHub PR state as a proxy.

3. **Merge confirmation: required or optional?**: Should the agent always require an explicit human "merge now" confirmation after CI passes, or is CI-green sufficient for auto-merge? This is a policy decision only the user can make. The research suggests requiring human confirmation (every major agent platform does), but the user may want to allow auto-merge for trusted stacks.

4. **What is "the actor" for merge operations?**: Should the agent merge PRs as a GitHub App (bot identity), as the PR author (impersonated via token), or as a human-approved service account? Graphite's merges are currently attributed to the Graphite App. Your plugin's merges should have a clear, auditable actor identity. Decide before implementing.

5. **Conflict resolution boundary**: How far should the agent go before escalating? Recommended: agent suggests a resolution, human approves it, agent applies it. But you may want the agent to auto-apply trivial conflicts (import order, whitespace) without human approval. Define the threshold explicitly.

6. **Session persistence mechanism**: Where is the JSONL state file stored? Per-project (in `.claude/merge-queue/` in the repo), per-user (in `~/.claude/merge-queue/`), or in an external store? Per-project is observable and version-controllable. Per-user is simpler for single-user setups. Choose one.

7. **gt-workflow plugin integration**: Your existing `gt-workflow` plugin handles the create/submit side. Does `merge-queue` depend on `gt-workflow` being installed? Should it? Clarify the dependency boundary: `gt-workflow` owns branch creation and PR submission; `merge-queue` owns queue entry through merge. Ensure they don't double-register hooks for the same tool calls.

8. **Stack vs. single-PR scope**: MVP for single PRs only? Or must it handle stacks natively from day one? Stacks are more complex (all ancestors must be enqueued, dequeue of one affects all upstack PRs). Given Graphite's stack-first model, punting stack support to v2 may leave significant functionality gaps.

---

## 9. Sources

- [Graphite Merge Queue Docs](https://graphite.dev/docs/graphite-merge-queue) — core queue lifecycle, stack-aware behavior, lazy rebase
- [Graphite Merge Pull Requests](https://graphite.dev/docs/merge-pull-requests) — fast-track, pause, manual merge, `gt sync`
- [Graphite Merge Queue Batching Blog](https://graphite.dev/blog/merge-queue-batching) — draft PR / fast-forward merge model
- [Graphite Merge Queue Optimizations](https://graphite.dev/docs/merge-queue-optimizations) — parallel CI isolation, bisection
- [Graphite Stacking and CI](https://graphite.dev/docs/stacking-and-ci) — CI optimizer step, up-stack CI gotchas
- [Graphite GitHub Configuration Guidelines](https://graphite.dev/docs/github-configuration-guidelines) — branch protection, bypass actors, incompatibility with GitHub native queue
- [Graphite Command Reference](https://graphite-58cc94ce.mintlify.dev/docs/command-reference.md) — `gt create`, `gt modify`, `gt submit`, `gt restack`, `gt sync`, `gt absorb`
- [GitHub — Managing a Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) — grouping strategy, `max_entries_to_build`, `ALLGREEN`/`HEADGREEN`
- [GitHub — Merging with a Merge Queue](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request-with-a-merge-queue) — FIFO ordering, enqueue mechanics
- [GitHub — Auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) — single-PR semantics, write-access requirement
- [GitHub — Webhook Events and Payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) — `merge_group` event schema, `pull_request.dequeued`
- [GitHub Changelog — merge_group GA (July 2023)](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/) — `destroyed` action, `pull_request.dequeued`, GraphQL mutations
- [GitHub Changelog — merge_group beta API (April 2023)](https://github.blog/changelog/2023-04-19-pull-request-merge-queue-public-beta-api-support-and-recent-fixes/) — `enqueuePullRequest`, `dequeuePullRequest`, `mergeQueueEntry`
- [GitHub Changelog — merge_group webhook event (August 2022)](https://github.blog/changelog/2022-08-18-merge-group-webhook-event-and-github-actions-workflow-trigger/) — original `checks_requested` action, Actions trigger
- [MagicBell — merge_group payload sample](https://magicbell.com/workflows/github/merge-group-checks-requested) — community-confirmed payload shape
- [GitHub Docs — Events that trigger workflows](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows) — `merge_group` Actions trigger
- [GitHub Docs — Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule) — bypass actors, push restrictions
- [Claude Code — GitHub Actions](https://code.claude.com/docs/en/github-actions) — `@claude` integration, automation mode, `CLAUDE.md`
- [Claude Code — Routines](https://code.claude.com/docs/en/routines) — `merge_queue` trigger support, HTTP endpoints
- [Devin — Review](https://docs.devin.ai/work-with-devin/devin-review) — human-in-the-loop merge controls
- [Mergify — Merge Queue Rules](https://docs.mergify.com/merge-queue/rules/) — grouping strategy, impersonation, retry patterns
- [Mergify — Batches](https://docs.mergify.com/merge-queue/batches/) — batch failure isolation patterns
- [Trunk.io — Introduction to Merge Queues](https://trunk.io/learn/introduction-to-merge-queues-what-you-need-to-know) — industry survey, Shopify Shipit pattern
- [Trunk.io Blog — Wrong commit regression](https://trunk.io/blog/what-happens-if-a-merge-queue-builds-on-the-wrong-commit) — speculative commit anchoring incident
- [joshcannon.me — gh-mq branches unprotectable](https://joshcannon.me/2025/07/03/gh-mq-branches-unprotectable.html) — queue branch protection gap
- [AWS — Idempotency best practices](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/) — idempotency token patterns
- [Buildkite — GitHub Merge Queue](https://buildkite.com/docs/pipelines/tutorials/github-merge-queue) — CI integration patterns for queue branches
- [LLVM Discourse — Graphite Merge Queue RFC](https://discourse.llvm.org/t/rfc-enabling-graphite-merge-queue-to-resolve-infinite-loops-while-merging-stacked-prs/88769) — out-of-band merge causing Graphite CI restarts
- [GitHub community — head_ref format instability](https://github.com/orgs/community/discussions/62219) — do not parse `head_ref` for PR number
- [merge-queue.academy](https://merge-queue.academy/introduction/how-merge-queues-work/) — canonical merge queue model reference

**Skipped sources (unavailable):**
- `mcp__plugin_yellow-research_ceramic__ceramic_search` — unavailable (not in deferred tool registry)
- `mcp__plugin_yellow-research_parallel__createDeepResearch` — unavailable (not in deferred tool registry)
- `mcp__plugin_yellow-research_perplexity__perplexity_research` — quota exhausted (401 Unauthorized)
