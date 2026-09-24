# Durable Review-Findings Ledger for yellow-review

**Date:** 2026-09-23 **Research basis:**
`docs/research/review-findings-persistence.md` (~70 sources + GitHits OSS-code
addendum) **Motivating failure:** `/review:sweep-all` on yellow-plugins PR #840
— 9 reviewers produced 10 residual findings (one P1 @ confidence 100, two
verified-accurate P2 doc errors), none were `safe_auto`, so none were applied,
none posted to GitHub, none persisted. `/review:resolve` only touched the 4
pre-existing bot threads. In an unattended sweep, every residual finding
evaporates with the transcript.

## What We're Building

A durable, append-only JSONL ledger of residual review findings (`autofix_class`
∈ `{gated_auto, manual}`, `owner=downstream-resolver`) that survives past the
end of any `/review:pr`, `/review:sweep`, or `/review:sweep-all` run —
regardless of which worktree or Claude session touches the PR next.

Confirmed today (`git rev-parse --git-common-dir` inside this worktree resolves
to `/home/kinginyellow/workspaces/yellow-harness_workspace/yellow-plugins/.git`,
the shared clone's git dir, not a per-worktree path):

- **Location & format:**
  `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl` — one
  append-only JSONL file per PR, shared automatically across every worktree of
  the same clone (the shared value is `git-common-dir`, not `git-dir`).
  Invisible to `git status`/PR diffs (lives inside `.git`), no
  `${CLAUDE_PLUGIN_DATA}`/`~/.claude` write, so no protected-dir confirmation
  prompt (anthropics/claude-code#41156) blocking unattended writes. Trade-offs
  accepted: lost if the clone is deleted, single-machine only.
- **Owner & consumer:** a new `/review:triage` command (mirroring
  `/debt:triage`'s pending→ready→fixed lifecycle) exclusively reads, mutates,
  and prunes the ledger. `/review:resolve` stays untouched —
  GraphQL/GitHub-threads-only, as today.
- **Attended vs. unattended semantics:** the `safe_auto`/`gated_auto`/`manual`
  gate exists to protect _unattended_ runs (no human to catch a bad auto-apply).
  When `/review:triage` runs attended, the human _is_ the safety mechanism, so
  it attempts everything in the ledger. When invoked non-interactively (from
  `sweep.md`/`sweep-all.md`), it applies only safe items and leaves the rest for
  next time.
- **Discoverability:** no GitHub-visible surface at all (no sticky comment, no
  Check run, no SARIF) — avoids Codex/Cursor bot reply-loops. Instead:
  `sweep-all.md`'s summary table gains a "Residual" count column, and a new
  SessionStart hook (yellow-debt's cheap-count pattern) prints one line when any
  open PR in this repo has pending ledger findings.
- **Dedup & false-positive suppression:** write-time fingerprint matching — skip
  re-adding anything with a terminal (`fixed`/`dismissed`) fingerprint already
  recorded, merge repeats of still-`open` entries. Fingerprint = deterministic
  primitives only (file, category, reviewer, line bucket — the strix approach
  from the research doc), never LLM title text, because titles get reworded
  between runs. In addition, `/review:pr` injects the PR's dismissed findings +
  dismissal reasons into reviewer prompts as a fenced advisory block (same
  pattern as the existing learnings-context block), because fingerprint-only
  dedup misses reworded re-detections of the same underlying issue — this
  directly addresses a documented risk in this repo's own history:
  `docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md`
  recorded a 38% false-positive rate in re-review rounds when prior
  fix/dismissal rationale isn't carried forward.
- **Staleness & lifecycle:** `/review:triage` re-verifies each entry's flagged
  region + condition against the current HEAD SHA before acting; non-matching
  entries become `stale` (shown to the human, never silently fixed or dropped —
  silent disappearance is exactly the bug this whole effort exists to fix). When
  a PR is observed merged/closed, its `findings/<pr>.jsonl` is deleted — no
  archive.

## Why This Approach

### Approach A: review-pr owns read+write via a shared ledger library — **Recommended**

A small shared script (e.g. `scripts/lib/review-ledger.sh`, mirroring
yellow-debt's `lib/validate.sh` — atomic `flock`-guarded append,
`umask 077`-style hygiene borrowed from compound-staging's
`cs_atomic_jsonl_write`) is called from two places in `review-pr.md`: near the
top of Step 6, it reads the ledger to build the dismissed-findings advisory
block injected into reviewer prompts; after Step 6.9's partition, it appends new
`owner=downstream-resolver` findings with dedup applied. `/review:triage` is the
only other component that touches the file (read + mutate + prune).
`sweep.md`/`sweep-all.md` need only cosmetic changes: the Residual-count column,
and `sweep.md` optionally invoking `/review:triage --non-interactive` at the
end.

**Pros:**

- Single source of truth — every `review-pr` caller (a human directly,
  `sweep.md`, `sweep-all.md`, anything invoking it in the future) gets full
  ledger persistence for free. No caller can "forget" to persist, which is
  exactly how PR #840's findings were lost.
- Smallest total footprint: one shared lib, one new command, one hook script,
  two small edits to existing sweep commands.
- Matches yellow-debt's own precedent almost exactly (shared lib + SessionStart
  hook + dedicated triage/fix command), so it reads as "the way this codebase
  already does durable findings," not a new pattern.

**Cons:**

- Touches `review-pr.md` — a stable, heavily-used command — in two places
  (context injection, write-after-partition).
- Slightly widens `review-pr`'s responsibility beyond pure
  detection/partitioning.

**Best when:** elegance and avoiding duplicated plumbing matter more than
keeping `review-pr.md` a pure read-only detector — which matches the stated goal
(minimal new surface, reuse existing patterns) better than isolating persistence
elsewhere.

### Approach B: Persistence via a SubagentStop hook, review-pr untouched for writes

Leave `review-pr.md`'s step list alone except for the unavoidable read-side
context injection (a single new fenced block, same minimal-touch shape as the
existing learnings-context block). All ledger _writes_ happen in a new
`SubagentStop` hook — matching compound-staging's own hook-driven capture
pattern — that fires whenever a `review-pr` task subagent completes, parses its
compact-return JSON, and appends residual findings to the ledger.

**Pros:** zero footprint inside `review-pr.md`'s visible step list for the write
path; reuses an established yellow-core extension mechanism (hooks) instead of
editing steps.

**Cons:** yellow-review ships **zero hooks today** (confirmed by reading the
plugin catalog) — this approach introduces a new category of infrastructure
(hook registration, `plugin.json` changes) for a single use case; hook-based
capture is harder to observe/debug than an explicit step (nothing visible in the
command transcript); the compact-return JSON isn't guaranteed to be cleanly
available to a `SubagentStop` hook in the exact shape needed — it would likely
have to re-parse chat output rather than call a lib function directly, which is
more fragile plumbing for the same outcome as Approach A.

**Best when:** you specifically want zero lines changed in `review-pr.md`'s step
list and are willing to invest in hook infrastructure yellow-review doesn't have
yet. Not recommended here — it's more total surface, not less, for the same
result.

### Approach C: `/review:triage` re-runs detection itself, review-pr untouched entirely

Don't touch `review-pr.md` at all — not even for reads. `/review:triage`
re-invokes a lightweight subset of review-pr's own reviewer logic (or re-parses
the last run's raw transcript) on demand to reconstruct residual findings, then
writes the ledger just-in-time.

**Cons (why this is not viable given the decisions already made):** re-running
LLM-based detection is expensive and non-deterministic — findings could differ
between the original run and triage's reconstruction, reintroducing a version of
the "results evaporate" problem from a different angle. It also can't satisfy
the dismissed-findings context-injection decision above, which requires
`review-pr` itself to be context-aware at generation time, not reconstructed
after the fact. Included here only to show why "touch nothing in review-pr.md"
isn't actually on the table once dismissed-context injection is required.

### Recommendation

**Approach A.** It is the only one of the three that is simultaneously
consistent with every decision already locked in during this brainstorm
(dismissed-context injection requires `review-pr` to read the ledger; uniform
write-on-every-call requires `review-pr` to write it too) while adding the least
new infrastructure — no new hook category, no re-run-detection risk, and a shape
that mirrors yellow-debt's existing lib+hook+command pattern closely enough that
a future maintainer will recognize it immediately.

## Key Decisions

| #   | Decision                                                                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ledger at `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl`, JSONL, one file per PR                                                  | Shared across worktrees of the same clone by construction (verified: `git-common-dir` ≠ per-worktree `git-dir`); invisible to git status/PR diff; no protected-dir prompt. Research doc explicitly warns against keying by cwd/worktree path — this sidesteps that failure mode without introducing a new out-of-tree location. |
| 2   | New `/review:triage` command owns the ledger exclusively; `/review:resolve` stays GraphQL-only                                                           | Keeps `resolve-pr.md`'s existing, working GitHub-thread contract stable; avoids conflating "GitHub-visible unresolved threads" with "locally-tracked residual findings," which are genuinely different data sources with different lifecycles.                                                                                  |
| 3   | Attended = fix everything; unattended = safe-only, leave the rest                                                                                        | The safe/gated/manual gate is a proxy for "is a human watching." A present human already provides the review a gate is meant to simulate — gating them too is pure friction with no safety benefit.                                                                                                                             |
| 4   | No GitHub-visible surface; local-only discovery (sweep-all Residual column + SessionStart one-liner)                                                     | Matches yellow-debt's own discovery pattern; avoids Codex/Cursor bot reply-loop triggers entirely by never posting anything for them to react to.                                                                                                                                                                               |
| 5   | Write-time dedup (deterministic fingerprint: file, category, reviewer, line bucket) + dismissed-findings prompt injection                                | Fingerprint alone misses reworded re-detections (LLM titles vary run to run); prompt injection closes that gap using the same fenced-advisory pattern already used for learnings-context. Directly informed by this repo's own past-learnings record of a 38% re-review false-positive rate without prior-resolution context.   |
| 6   | Re-verify against current HEAD SHA before acting; mark non-matching entries `stale` (visible, not silently dropped); prune ledger file on PR merge/close | Force-pushes are tolerated (PR number is stable, fingerprint ignores exact line), but code can drift enough that a fix no longer applies cleanly — silently forcing it or silently dropping it both recreate the "findings vanish" problem this whole effort targets.                                                           |

## Suggested Stack Decomposition

For `/flow:plan` to pick up, in dependency order:

1. **Ledger library + schema** — `scripts/lib/review-ledger.sh` (or equivalent):
   atomic `flock`-guarded JSONL append, fingerprint function (file + category +
   reviewer + line-bucket), dedup/state-check function, dismissed-findings
   reader (for context injection), prune-on-close function. This is the one
   piece everything else depends on.
2. **`review-pr.md` integration** — add the dismissed-context read near the top
   of Step 6 (fenced advisory block into reviewer prompts); add the ledger-write
   call after Step 6.9's partition, for `owner=downstream-resolver` findings
   only.
3. **`/review:triage` command** — new command file mirroring `/debt:triage`'s
   structure: read ledger, re-verify against HEAD SHA, mark `stale` on mismatch,
   attended = attempt all / `--non-interactive` = safe-only, write back state
   transitions (`open`→`fixed`/`dismissed`/`stale`), prune when PR is observed
   merged/closed.
4. **`sweep.md` / `sweep-all.md` integration** — add the "Residual" count column
   to the summary table; `sweep.md` optionally invokes
   `/review:triage --non-interactive` as a final step.
5. **SessionStart hook** — new lightweight hook script (yellow-debt's
   filename/count-regex pattern, not full JSON parsing) that checks for
   non-empty findings files for open PRs in the current repo and emits a
   `systemMessage`.

## Open Questions

- Exact JSONL record field names/schema (title, severity, category, file, line,
  confidence, autofix_class, owner, fingerprint, state, dismissal_reason,
  created_at, reviewer, pr_head_sha at write time, etc.) — needs to be nailed
  down at plan time, informed by review-pr's existing 10-field compact-return
  schema.
- Exact mechanics of "re-verify against current HEAD SHA" — is this a targeted
  re-read of the flagged file region and a heuristic content match, or something
  more structured? Not resolved here; a plan-level implementation detail.
- How does `sweep.md`/`/review:triage` detect "PR merged/closed" to trigger
  pruning — a `gh pr view --json state` check at the start of a triage run, or
  something event-driven?
- Should the optional `plugin-contract-reviewer` extension fields
  (`breaking_change_class`, `migration_path`) be persisted in ledger entries, or
  dropped at write time since they're supplementary?
- Testing/eval strategy for `/review:triage` itself (it's a new command with
  real filesystem mutation and re-verification logic) — not addressed in this
  brainstorm.
- Whether attended `/review:pr`'s Step 10 chat report should visually
  distinguish "just written to the ledger this run" from "carried over from a
  prior sweep" — a UX nicety not resolved here.
