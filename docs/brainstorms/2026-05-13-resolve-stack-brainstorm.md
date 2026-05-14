---
date: 2026-05-13
topic: resolve-stack command for yellow-review
status: ready-for-plan
---

# Brainstorm: /review:resolve-stack

## What We're Building

A new `/review:resolve-stack` command for `plugins/yellow-review/` that
traverses a Graphite stack in bottom-up dependency order and runs the
`/review:resolve` comment-resolution flow on each open PR in sequence.
The stack-traversal logic shared with `review-all` is extracted into a new
skill (`yellow-review:review:stack-traversal`) so both commands consume the
same walk — preventing the sibling-command drift flagged in MEMORY.md PR #8.

The command targets users who have accumulated unresolved reviewer comments
across a multi-PR stack and want to address them all without manually invoking
`/review:resolve` per branch.

## Why This Approach

The selected approach — extend `review-all` via shared traversal — is the
right call for three reasons grounded in the existing codebase:

1. `review-all.md` already implements a correct bottom-up Graphite stack walk
   (`gt log short --no-interactive` → filter open PRs → order base-to-tip →
   adopt non-Graphite PRs via `gt track`). Duplicating this in a sibling
   command creates two maintenance surfaces for the same Graphite semantics.

2. `review-all.md` already embeds the resolve step inline (Step 12: "Fetch
   unresolved comments → run /review:resolve flow if any exist"). The delta
   between `review-all` and `resolve-stack` is exactly the per-PR action —
   the traversal is identical.

3. MEMORY.md "Plugin Review Consistency Patterns" (PR #8) explicitly flags
   sibling-command drift as a recurring problem in this repo. A shared
   traversal skill is the canonical fix.

The alternative — a mode flag (`review-all --resolve`) — was considered and
rejected: it conflates two distinct user intents (full review pipeline vs.
comment-only resolution pass), complicates the `review-all` argument parser,
and obscures discoverability since `/review:resolve-stack` is the natural
sibling of `/review:resolve` and `/review:sweep`.

## Key Decisions

### 1. Two sibling commands, not a mode flag

**Decision:** `resolve-stack` is a standalone command in
`commands/review/resolve-stack.md`, not a `--resolve` flag on `review-all`.

**Rationale:** Discoverability and naming coherence. The existing surface is:
`/review:pr`, `/review:resolve`, `/review:sweep` (pr + resolve on one PR),
`/review:all` (full review pipeline across the stack). The natural gap in this
matrix is: resolve-only across the stack. Naming it `resolve-stack` makes the
relationship to `resolve` obvious. A mode flag on `review-all` would bury the
capability and force users to remember a flag rather than a command name.
Complexity of plumbing one extra flag through `review-all`'s already-long
argument parser is not zero — two clean files is simpler.

### 2. Per-PR error policy: skip-and-continue with AskUserQuestion on agent error

**Decision:** Three-tier error policy keyed on failure class:

| Failure class | Policy |
|---|---|
| No unresolved comments on PR N | Skip silently — cheap no-op, continue |
| `resolve-pr` script failure (non-zero exit from `get-pr-comments` or `resolve-pr-thread`) | Log error, continue to next PR — same as `review-all`'s individual-PR-failure policy |
| `gt submit` conflict / restack conflict on PR N | Abort the walk at PR N, surface via AskUserQuestion: "Restack conflict on PR #N. Resolve manually and re-run, or continue skipping this PR?" |
| `pr-comment-resolver` agent CONFLICT sentinel | Surface per existing `resolve-pr` Step 5 logic within that PR's resolve pass — already handled; no new stack-level policy needed |

**Rationale:** The `review-all` precedent (MEMORY.md, `review-all.md` Step 4
base-ref fallback + Step 13 restack-conflict handling) already establishes
skip-and-continue for transient per-PR failures. Applying the same policy here
is consistent and avoids aborting a 5-PR stack because PR 2 has a rate-limit
blip. Restack conflicts are the one case that warrants a pause because
continuing on top of an unrestacked branch produces incorrect base refs for
subsequent PRs.

### 3. Submit cadence: per-PR `gt submit` after each resolve

**Decision:** `gt submit --no-interactive` after each PR's resolve pass
completes successfully, before moving to the next PR. No batch submit at the
end.

**Rationale:** `review-all` already does this (Step 11: commit + submit before
Step 13 restack). More importantly, batch submit at the end means a failure on
PR 5 of a 5-PR stack rolls back or stalls all five pushes — the user gets
nothing. Per-PR submit means PRs 1-4 are published even if PR 5 fails. The
blast radius is contained to one PR. The latency cost (one `gt submit` round
trip per PR) is acceptable: resolve-stack is already a human-supervised,
multi-minute operation.

The AskUserQuestion push-confirmation gate from `resolve-pr` Step 6 is
preserved per-PR — MEMORY.md explicitly requires human-in-the-loop before any
LLM-generated code push. This gate already exists inside `resolve-pr`; the
stack command does not need to duplicate it.

### 4. Cascade-detection scope: deferred to v2

**Decision:** No cascade-detection logic in v1. A PR whose comments reference
lines modified by a lower PR in the stack is handled the same as any other PR
— the resolver reads the current file state (post-restack) and applies the fix
or skips with "context not found at line N."

**Rationale:** YAGNI. The `pr-comment-resolver` already handles stale line
anchors via its ±20-line search and "context not found" fallback (agent
`pr-comment-resolver.md` Step 4b/4c). That covers the common cascade case:
the comment's line shifted because of a lower-PR fix, but the code is still
nearby and findable. The edge case where the code was genuinely removed by a
lower PR produces a "context not found" skip — which is the correct outcome
(the fix was superseded). A full cascade-detection layer (diff new-lines
check, comment-position remapping across rebase) is non-trivial and can be
added in v2 if "context not found" false-negative rates prove to be a
problem.

### 5. Comment classification: delegate entirely to resolve-pr

**Decision:** `resolve-stack` adds no new comment classification. It delegates
fully to the existing `resolve-pr` pipeline (Steps 3c actionability filter,
3d clustering, parallel resolver dispatch).

**Rationale:** The "defer this comment until PR N-1 lands" case is already
handled by cascade-detection deferral (Decision 4). The actionability filter
and clustering logic in `resolve-pr` are already correct and well-tested. A
stack-level classification layer would either duplicate that logic or require
threading stack-position metadata into the resolver agent — unnecessary
complexity for v1.

### 6. UX checkpointing: per-PR push gate, no additional inter-PR pause

**Decision:** The per-PR AskUserQuestion from `resolve-pr` Step 6 ("Push these
changes to resolve PR #X comments?") is the only mandatory pause. No
additional between-PR "continue to next PR?" prompt is added by default.

**Rationale:** Each `resolve-pr` invocation already includes the human-in-the-
loop push gate — MEMORY.md's requirement is satisfied by delegation. An
additional between-PR confirmation would make the command require N+1
interactions for an N-PR stack, which is onerous for a 5-PR stack. If the
user wants to stop mid-stack they can decline the push gate for the current PR
(the command reports "changes uncommitted, continuing to next PR") or Ctrl-C.
The `review-all` precedent does not add an inter-PR gate either.

One exception: if `gt upstack restack` produces a conflict after a PR's
resolve, the command pauses via AskUserQuestion (see Decision 2 error policy).
That is a decision point, not a routine checkpoint.

### 7. Idempotency: PRs with no unresolved comments are silent no-ops

**Decision:** When `get-pr-comments` returns zero unresolved threads for a PR,
log "PR #N: no unresolved comments — skipping." and continue to the next PR
without spawning any resolver agents or prompting the user.

**Rationale:** The existing `resolve-pr` Step 3 already handles this: "If no
unresolved comments: report 'No unresolved comments found on PR #X.' and exit
successfully." The stack command inherits this behavior by delegating. A second
run of `resolve-stack` on a fully-resolved stack produces N skip messages and
exits — cheap, correct, and non-destructive.

## Shared Traversal Skill

The stack walk is extracted into
`plugins/yellow-review/skills/stack-traversal/SKILL.md`. Both `review-all` and
`resolve-stack` load this skill. The skill encapsulates:

- `gt log short --no-interactive` parsing (strip graph characters, extract
  branch names)
- `gh pr view <branch> --json number,state` per-branch open-PR filter
- Base-to-tip ordering
- Non-Graphite PR adoption via `gt track` with degraded-mode fallback
- Working-directory clean check (`git status --porcelain`)
- The `gt upstack restack` call after each PR's action, with conflict handling

The per-PR action (what to DO on each PR once checked out) is left to the
consuming command. `review-all` passes the full Wave 2 review pipeline;
`resolve-stack` passes the `resolve-pr` flow.

`review-all.md` is updated to load the skill and remove the duplicated
traversal prose, replacing it with a reference to the skill's section headers.
The mirror-comment (`<!-- This block must mirror review-pr.md Steps 3a–9b -->`)
is preserved for the review-specific pipeline steps that are NOT in the shared
skill.

## Open Questions

1. **`sweep-stack` symmetry** — Should a `/review:sweep-stack` command
   (review + resolve across the whole stack) be planned alongside this PR, or
   deferred? It would be a thin wrapper: call `review-all` then `resolve-stack`,
   gated by an AskUserQuestion boundary between them (same pattern as
   `sweep.md`). The shared traversal skill makes this cheap to add. Deferred
   for now — `resolve-stack` is the stated goal; `sweep-stack` can be a follow-
   up changeset.

2. **Skill vs. inline prose for traversal** — Claude Code skills are loaded
   via the `Skill` tool in command bodies, but `review-all` currently runs the
   traversal inline (not via a Skill invocation). The shared traversal skill
   can be expressed as a SKILL.md (loaded via `Skill` tool) or as a shared
   prose section referenced by both command files. The `Skill`-tool approach is
   cleaner for DRY but adds one tool invocation per command startup. Decision
   deferred to the plan phase — either approach satisfies the brainstorm goal
   of a single source of truth.

3. **`resolve-pr` invocation mechanism** — `resolve-stack` can invoke the
   per-PR resolve pass two ways: (a) via the `Skill` tool (`skill:
   "review:resolve"`, same as `sweep.md` Step 4), or (b) inline, mirroring the
   steps directly (same as `review-all` Steps 12 inline). The `Skill`-tool
   approach requires an AskUserQuestion failure-boundary gate between each PR
   (same as `sweep.md` Step 3) because the Skill tool returns no machine-
   readable exit status. The inline approach avoids that extra gate but
   duplicates the resolve-pr prose. Given `resolve-stack` is exclusively a
   resolve command (not review+resolve like sweep), the inline approach may be
   simpler for v1 — the full resolve-pr pipeline is fewer steps than the full
   review-pr pipeline that `review-all` inlines. To be decided in the plan.
