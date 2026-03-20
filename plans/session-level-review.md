# Feature: Session-Level Review for workflows:review

## Overview

Transform `workflows:review` from a thin redirect to `review:pr` into a
session-level review command that evaluates all work completed during a
brainstorm → plan → work session. The command assesses three dimensions — plan
adherence, cross-PR coherence, and scope drift — then autonomously applies fixes
for P1 issues. Output is an inline summary table plus an optional persistent
review document.

This fills the gap between per-PR code quality review (`review:pr`) and
knowledge extraction (`workflows:compound`) by catching session-level problems
that are invisible at the individual PR level.

## Problem Statement

### Current Pain Points

The `workflows:review` command is a 34-line redirect to `review:pr`. It provides
no session-level awareness:

- **No plan adherence checking.** A user can run `workflows:work` on a plan,
  skip acceptance criteria, and `review:pr` will not catch it because it reviews
  code quality, not plan completeness.
- **No cross-PR coherence.** Stacked PRs may use inconsistent naming, duplicate
  logic, or break import chains between branches. `review:all scope=stack`
  reviews each PR independently — it cannot detect cross-PR inconsistencies.
- **No scope drift detection.** Work that expands beyond the plan goes unnoticed.
  Gold-plating and tangent features accumulate without visibility.

### User Impact

Users completing the workflows pipeline (brainstorm → plan → work → review)
get per-PR code quality feedback but no feedback on whether the session achieved
its goals. The "review" step in the pipeline is effectively a per-PR duplicate
of what `workflows:work` Phase 5 already does.

## Proposed Solution

### High-Level Architecture

Replace the redirect with a two-phase command:

```
Phase 1: Review
  ├─ Detect session context (plan file, stack, branch)
  ├─ Gather combined diff across all session PRs
  ├─ Evaluate 3 dimensions (plan adherence, coherence, scope drift)
  └─ Produce findings list with severity (P1/P2/P3)

Phase 2: Remediate (autonomous)
  ├─ For each P1 finding with a concrete fix:
  │   ├─ Checkout target branch
  │   ├─ Apply fix via Edit tool
  │   ├─ Commit and submit
  │   └─ Restack if needed
  ├─ Re-review (cycle 2)
  │   ├─ If issue count decreased: report remaining issues
  │   └─ If no progress or max cycles: stop and report
  └─ Print inline summary + optional persistent doc
```

### Key Design Decisions

**1. Direct fix application instead of `workflows:work` delegation.**

The brainstorm proposed invoking `workflows:work` with a remediation plan.
Spec-flow analysis identified three blocking incompatibilities:

- `workflows:work` always creates new branches via `gt create` — remediation
  needs to fix existing branches.
- `workflows:work` has 4+ `AskUserQuestion` call sites that block autonomous
  execution (branch decisions, ambiguity clarification, checkpoints).
- `workflows:work` in single-branch mode prompts "Continue on this branch or
  create new one?" — there is no way to pre-answer this.

**Resolution:** Phase 2 applies fixes directly using Edit/Bash tools, following
the proven `review:pr` Step 6 pattern. This avoids all `workflows:work`
incompatibilities while preserving the autonomous fix loop. A future
`--remediation` mode for `workflows:work` could replace this if needed.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `review:pr` Step 6 (lines 142-147 of
> `review-pr.md`) sorts findings P1→P2→P3, then applies P1 and P2 fixes
> sequentially using the Edit tool. Agents are explicitly instructed "Do NOT
> edit any files. Report findings only." The command is the sole editor.
> However, `review:pr` Step 8 asks user confirmation via `AskUserQuestion`
> before pushing. The plan must decide: skip confirmation (truly autonomous) or
> ask once after all fixes? The brainstorm specified "fully autonomous, no user
> confirmation needed."
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The SWE-CI benchmark (arXiv) found most coding agents break 75%+
> of their own fixes over time. Proven mitigations: (1) git commit after each
> successful fix to enable rollback if next fix regresses, (2) run full test
> suite after each fix (not just failing test), (3) cap fix attempts at 2-3 per
> individual issue. The "Ralph Loop" pattern (external reviewer in a while loop)
> typically converges in 2-3 cycles, supporting the plan's max-2 design. See:
> [SWE-CI Benchmark](https://engineerscodex.com/swe-ci-coding-agent-benchmark/)
<!-- /deepen-plan -->

**2. Argument disambiguation.**

String arguments could be file paths or branch names:

- Check `[ -f "$ARGUMENTS" ]` first → if file exists, session-level review
- Otherwise → redirect to `review:pr` (existing behavior preserved)
- No arguments → auto-detect session context

**3. Review dimensions are LLM-judgment with structured prompts.**

Cross-PR coherence and scope drift classification are inherently judgment calls.
Rather than building brittle regex heuristics, each dimension uses a structured
prompt with concrete examples and rubrics. The LLM examines the combined diff
against the plan and classifies findings.

**4. Session-level review does NOT invoke `review:pr` or `review:all`.**

These are complementary, not overlapping:

- `review:pr` / `review:all` → per-PR code quality (security, simplicity, tests)
- `workflows:review` → session-level plan alignment (adherence, coherence, drift)

The user may run both. Session-level review should not re-run per-PR agents.

### Trade-offs

| Decision | Benefit | Cost |
|---|---|---|
| Direct fixes over `workflows:work` | No interactive prompt issues, no branch creation conflicts | Cannot reuse `workflows:work` test execution or quality checks |
| LLM-judgment over heuristics | Handles nuanced cases (intentional vs unintentional drift) | Less deterministic, harder to test |
| Max 2 fix cycles | Prevents infinite loops | May leave fixable issues after 2 cycles |
| P1-only auto-fix | Limits blast radius of autonomous changes | P2 issues require manual attention |

## Implementation Plan

### Phase 1: Command Foundation

- [ ] 1.1: Replace the redirect in `plugins/yellow-core/commands/workflows/review.md` with new command structure. Update frontmatter: name, description, argument-hint, allowed-tools (Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion, ToolSearch, Skill, ruvector MCP tools). Keep backwards-compatible redirect logic for PR number/URL/branch arguments.

<!-- deepen-plan: codebase -->
> **Codebase:** The frontmatter must use `allowed-tools:` (not `tools:` — that
> is for agents only per MEMORY.md). The ruvector MCP tools must be listed
> individually: `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`,
> `mcp__plugin_yellow-ruvector_ruvector__hooks_remember`,
> `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities`. The `description:`
> field must be single-line (no YAML block scalars `>`, `|`, etc. — parser
> constraint per MEMORY.md). All listed tool names validated against 83 existing
> commands.
<!-- /deepen-plan -->

- [ ] 1.2: Implement argument disambiguation. Parse `$ARGUMENTS`: if file exists on disk → session-level review mode; if numeric or URL or branch name → redirect to `review:pr` via Skill tool; if empty → auto-detect session context. Detection order: (1) find most recent `plans/*.md` modified in last 24h, (2) check Graphite stack via `gt log short --no-interactive`, (3) fall back to current branch redirect.

- [ ] 1.3: Implement session context loading. Read plan file, extract: `## Acceptance Criteria` section, `## Stack Decomposition` section (if present), `## Implementation Plan` tasks, `## Technical Specifications` scope (files to modify/create). For stacked sessions, map stack items to PR branches. For single-branch sessions, get the current branch's PR.

- [ ] 1.4: Add prerequisite checks. Verify clean working directory (`git status --porcelain`), verify `gh` and `gt` are available, verify at least one open PR exists for the session. If any check fails, report error and exit.

### Phase 2: Review Dimensions

- [ ] 2.1: Implement plan adherence analysis. Gather the combined diff across all session branches (`git diff main...<branch>` for each). Compare acceptance criteria from the plan against the diff — for each criterion, classify as: met (evidence in diff), unmet (no evidence), or partially met. For unmet criteria, check if there is a plausible justification (e.g., criterion was about docs and docs exist but weren't in the diff). Report unmet criteria as P1 findings with suggested implementation tasks.

<!-- deepen-plan: external -->
> **Research:** The "Rubric Is All You Need" paper (arXiv 2503.23989v1)
> recommends **point-by-point evaluation (PRE)** — feed each acceptance
> criterion one at a time to the LLM rather than the entire list at once. This
> is stricter because the LLM focuses on one criterion without compensating
> missed items with partial credit. The CODEJUDGE framework adds
> "Taxonomy-Guided Fault Localisation" — categorizing issues by severity
> (Negligible/Minor/Major/Fatal). Consider evaluating criteria individually
> rather than holistically for more reliable adherence checking.
<!-- /deepen-plan -->

- [ ] 2.2: Implement scope drift detection. Compare files changed in the combined diff against files listed in the plan's `## Technical Specifications` (Files to Modify, Files to Create) and `## Stack Decomposition` Scope fields. Files changed but not in the plan are candidates for drift. For each candidate: AI-classify as "justified divergence" (necessary consequence of implementation — e.g., updating a lock file, fixing a discovered bug) or "unintentional drift" (gold-plating, tangent feature). Justified divergences are P3 (informational). Unintentional drift is P2 (reported for user attention, not auto-fixed — reverting code is dangerous).

<!-- deepen-plan: external -->
> **Research:** CodeRabbit and Qodo provide related "ticket misalignment"
> detection — comparing PR changes against linked issues. The synthesized best
> practice from multiple sources is to use an ALIGNED/SUPPORTING/DRIFT/
> CONTRADICTS classification per change: ALIGNED = directly implements a plan
> item; SUPPORTING = necessary prerequisite not in plan; DRIFT = unrelated;
> CONTRADICTS = opposes plan intent. This four-category scheme is richer than
> the plan's two-category (justified/unintentional) and avoids the false
> positive of flagging necessary supporting work as drift.
> See: [CodeRabbit PR Validation](https://docs.coderabbit.ai/changelog)
<!-- /deepen-plan -->

- [ ] 2.3: Implement cross-PR coherence analysis. For stacked PRs only (skip for single-branch sessions). Gather diffs for each branch separately. Analyze for: (a) naming inconsistency — exported symbols that follow different conventions across branches; (b) pattern divergence — same problem solved differently in different PRs (e.g., error handling, validation); (c) import chain integrity — types/functions exported by branch N correctly imported by branch N+1 in a linear stack. Report inconsistencies as P1 (broken imports/contracts) or P2 (naming/pattern drift).

<!-- deepen-plan: external -->
> **Research:** No existing tool (Graphite, ghstack, Sapling, spr, git-town)
> performs semantic cross-PR coherence analysis. All handle structural concerns
> (merge order, conflict detection, CI status) but none analyze content
> consistency across a stack. Graphite shows "upstack change indicators" (orange
> bars) when code in a PR is modified again in a later PR, but this is visual,
> not automated analysis. This is a **novel capability** — keep scope focused on
> high-value checks: (1) symbol cross-reference (defined in PR N, used in PR
> N+1), (2) shared constant consistency, (3) API contract alignment. See:
> [Graphite Stack Review Best Practices](https://graphite.com/docs/best-practices-for-reviewing-stacks)
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** For large stacks (5+ PRs), consider delegating cross-PR
> coherence to a Task-spawned subagent to avoid context exhaustion. The combined
> diffs of all branches plus the plan file could exceed the command's context
> window. `review:pr` Step 5 uses Task tool for parallel agent spawning — the
> same pattern could isolate coherence analysis in a separate context. The
> existing `review:all` command processes PRs sequentially with zero cross-PR
> synthesis, confirming this is entirely new territory.
<!-- /deepen-plan -->

- [ ] 2.4: Structure findings output. Each finding uses the standard format from `pr-review-workflow` skill: `**[P1|P2|P3] dimension -- file:line** Finding: <issue> Fix: <suggestion>`. Dimensions are: `plan-adherence`, `scope-drift`, `cross-pr-coherence`. Collect all findings into a sorted list (P1 first).

### Phase 3: Autonomous Fix Loop

- [ ] 3.1: Implement P1 fix application. For each P1 finding with a concrete fix suggestion: (a) determine target branch from the finding's file path and stack mapping; (b) if not on the target branch, `gt checkout <branch>`; (c) apply fix via Edit tool; (d) run a targeted test if applicable (`pnpm test` or equivalent scoped to changed files). Track which branch has uncommitted changes.

<!-- deepen-plan: external -->
> **Research:** The Claude Code agent harness (arXiv 2603.05344v3) uses layered
> termination: iteration cap + doom loop detection + error budget (max 3
> recovery attempts per error sequence) + completion signal + pending work
> check. Anti-pattern from "Self-Correcting Agents" analysis: relying solely on
> LLM self-assessment for fix correctness — always require at least one
> deterministic signal (lint, test, type-check). Best practice: git commit after
> each successful fix to enable rollback if the next fix introduces regressions
> (snapshot/rollback pattern from SWE-CI).
<!-- /deepen-plan -->

- [ ] 3.2: Implement commit-and-submit for fixes. After all P1 fixes on a branch are applied: `gt modify -m "fix: address session review findings"` then `gt submit --no-interactive`. If the session spans multiple branches, repeat per branch. After all branches are submitted, `gt upstack restack` if any base branch in a linear stack was modified.

<!-- deepen-plan: codebase -->
> **Codebase:** The `gt modify` + `gt submit --no-interactive` pattern is
> confirmed as the standard across `review-pr.md` (lines 163-164),
> `review-all.md` (line 86), and `work.md` (lines 232-233). `gt upstack
> restack` is correct for restacking downstream branches after a base branch
> fix (used in `review-all.md` line 91 and `pr-review-workflow` SKILL.md line
> 179). Note: `review-all.md` handles cross-branch operations with the pattern
> `gt checkout <branch>` with fallback to `gh pr checkout` + `gt track`. The
> command does NOT return to the original branch after completion — the user is
> left on the last-touched branch. Follow this convention.
<!-- /deepen-plan -->

- [ ] 3.3: Implement re-review cycle. After Phase 2 fixes are applied, re-run the three review dimensions (tasks 2.1-2.3) on the updated diffs. Compare new issue count to previous: if P1 count decreased, continue to cycle 2 if max cycles not reached; if P1 count did not decrease (fixes created as many problems as they solved), stop. Max 2 review-fix cycles total.

- [ ] 3.4: Implement loop termination and summary. After the final cycle, collect all findings across all cycles. For each finding, record status: `Fixed` (applied and verified in re-review), `Reported` (P2/P3, not auto-fixed), `Persisted` (P1 that could not be fixed after 2 cycles). This data feeds the output phase.

### Phase 4: Output and Persistence

- [ ] 4.1: Implement inline summary table. Print a structured table to the terminal:
  ```
  Session Review: N issues found, M fixed (K cycles)

  | # | Dimension         | Issue                           | Severity | Status   |
  |---|-------------------|---------------------------------|----------|----------|
  | 1 | plan-adherence    | Missing test for auth middleware | P1       | Fixed    |
  | 2 | cross-pr-coherence| Inconsistent error format       | P2       | Reported |
  ```
  Include a verdict line: "Session is clean" (0 issues), "All issues resolved" (all fixed), or "N issues remain — review recommended" (unfixed P1/P2).

- [ ] 4.2: Implement persistent review document. When any P1 or P2 issues were found, write a review doc to `docs/reviews/YYYY-MM-DD-<plan-slug>-session-review.md`. Content: session metadata (plan file, branches, cycles), full findings with fix details, drift classification rationale, final status. Create `docs/reviews/` directory if it doesn't exist. Leave the file unstaged (user decides whether to commit).

<!-- deepen-plan: codebase -->
> **Codebase:** Use `mkdir -p docs/reviews || { printf '[session-review] Error:
> docs/reviews/ not writable.\n' >&2; exit 1; }` — this error handling pattern
> is standard across all runtime directory creation commands (e.g.,
> `brainstorm.md` line 18, `knowledge-compounder.md` line 281,
> `debt/audit.md`). Bare `mkdir -p` without error handling would be
> inconsistent with codebase conventions.
<!-- /deepen-plan -->

- [ ] 4.3: Update `plugins/yellow-core/CLAUDE.md` to reflect the new `workflows:review` behavior. Change the description from "redirects to /review:pr" to the new session-level review description. Update the "When to Use What" guidance in yellow-review's CLAUDE.md to differentiate session-level review from per-PR review.

### Phase 5: Integration and Polish

- [ ] 5.1: Add ruvector integration. Follow the canonical pattern from `mcp-integration-patterns` skill: recall at start with query prefix `"[session-review] "`, remember at end with tiered consent (P1 auto, P2 prompted). Graceful skip if ruvector not installed.

- [ ] 5.2: Add error handling for all failure modes. Skill tool failure (review:pr redirect), plan file not found, plan file missing expected sections (skip that dimension with a warning), dirty working directory, `gt` command failures, Edit tool failures. Follow the graceful degradation pattern used throughout the plugin.

- [ ] 5.3: Add context budget management. For large sessions (5+ PRs), the combined diff may exceed context. Mitigate by: (a) using `git diff --stat` first for scope drift (file-level, not line-level); (b) only reading full diffs for files flagged by the stat pass; (c) for cross-PR coherence, focus on exported symbols and imports rather than full file contents.

- [ ] 5.4: Validate the command with `pnpm validate:schemas` to ensure frontmatter is valid. Test argument disambiguation paths manually (plan file, PR number, empty args).

- [ ] 5.5: Create changeset via `pnpm changeset` — declare a `minor` bump for `yellow-core` (new command capability). This is required per project CLAUDE.md; CI blocks PRs that modify `plugins/*/` without a `.changeset/*.md` file.

<!-- deepen-plan: codebase -->
> **Codebase:** Every PR modifying a plugin must include a changeset (per
> MEMORY.md "Plugin Release Process"). This is a `minor` bump because it adds
> new functionality to an existing command (not just a bug fix). CI will block
> the PR without it.
<!-- /deepen-plan -->

## Technical Specifications

### Files to Modify

- `plugins/yellow-core/commands/workflows/review.md` — Replace redirect with
  full session-level review command (~300-400 lines)
- `plugins/yellow-core/CLAUDE.md` — Update workflows:review description

### Files to Create

- `docs/reviews/` — Directory for persistent review documents (created at
  runtime by the command, not pre-created)

### Files NOT Modified

- `plugins/yellow-core/commands/workflows/work.md` — No changes needed
- `plugins/yellow-review/commands/review/review-pr.md` — No changes needed
- `plugins/yellow-review/commands/review/review-all.md` — No changes needed
- No new agents created — the command performs analysis inline (same as
  `review:pr` Step 6 fix application pattern)

## Acceptance Criteria

1. `/workflows:review plans/foo.md` runs session-level review with plan
   adherence, scope drift, and cross-PR coherence analysis.
2. `/workflows:review 42` or `/workflows:review https://github.com/.../pull/42`
   redirects to `review:pr` (backwards compatible).
3. `/workflows:review` with no arguments auto-detects session context from
   recent plan files or Graphite stack; falls back to `review:pr` redirect.
4. P1 findings are autonomously fixed via Edit tool, committed, and submitted.
5. The fix loop terminates after max 2 cycles or when P1 count stops decreasing.
6. An inline summary table is printed showing all findings and their status.
7. A persistent review doc is written to `docs/reviews/` when P1 or P2 issues
   are found.
8. Clean sessions (no issues) produce a short "Session is clean" message.
9. Missing plan sections (no Acceptance Criteria, no Stack Decomposition) cause
   the corresponding dimension to be skipped with a warning, not an error.
10. `pnpm validate:schemas` passes after changes.

## Edge Cases & Error Handling

- **Plan file without Acceptance Criteria section:** Skip plan adherence
  dimension, warn "No acceptance criteria found in plan — skipping adherence
  check."
- **Single-branch session (no Stack Decomposition):** Skip cross-PR coherence
  dimension. Run plan adherence and scope drift on the single branch only.
- **All stack PRs already merged:** Report "All session PRs are merged — nothing
  to review" and exit.
- **Dirty working directory:** Error "Uncommitted changes detected. Commit or
  stash first." and exit before any review.
- **Fix introduces regression:** Monotonic progress check catches this — if P1
  count does not decrease after a fix cycle, loop terminates with "Fixes did not
  reduce issue count — stopping. Remaining issues reported below."
- **Plan file path does not exist:** Error with message, suggest checking path.
- **Argument is ambiguous (could be file or branch):** File existence check
  takes precedence. If file exists, session-level review. Otherwise, redirect.
- **Context exhaustion on large sessions:** Use `--stat` pass first, then
  targeted full diffs. For 5+ PRs, warn user that review may be slow.
- **`gt submit` failure after fix:** Report the failure, do not retry, continue
  with remaining fixes.

## Performance Considerations

- Combined diffs for 5+ stacked PRs can be large. Use `git diff --stat` for
  scope drift (file-level check) before reading full diffs.
- Cross-PR coherence only needs exported symbols and imports, not full file
  contents. Use Grep to extract these efficiently.
- The fix loop adds at most 2 additional review passes. Each pass is lighter
  than the initial review because it focuses on previously-flagged areas.

## References

- [Brainstorm document](../docs/brainstorms/2026-03-20-session-level-review-brainstorm.md)
- [Current workflows:review](../plugins/yellow-core/commands/workflows/review.md) — 34-line redirect
- [workflows:work](../plugins/yellow-core/commands/workflows/work.md) — Plan execution engine (678 lines)
- [review:pr](../plugins/yellow-review/commands/review/review-pr.md) — Per-PR review with fix application (Step 6 pattern)
- [review:all](../plugins/yellow-review/commands/review/review-all.md) — Batch PR review (sequential, no cross-PR analysis)
- [pr-review-workflow skill](../plugins/yellow-review/skills/pr-review-workflow/SKILL.md) — Finding format, severity definitions
- [Stack Decomposition contract](../plugins/gt-workflow/output-styles/stack-decomposition.md) — Stack metadata format

<!-- deepen-plan: external -->
> **Research:** External references from enrichment research:
> - [Claude Code Agent Harness](https://arxiv.org/html/2603.05344v3) — ReAct loop, doom loop detection, layered termination strategies
> - [SWE-CI Benchmark](https://engineerscodex.com/swe-ci-coding-agent-benchmark/) — Fix regression data, EvoScore metric, snapshot/rollback pattern
> - [Rubric Is All You Need](https://arxiv.org/html/2503.23989v1) — Point-by-point evaluation (PRE) for plan adherence checking
> - [Aider Lint-Test Loop](https://aider.chat/docs/usage/lint-test.html) — Auto-lint/auto-test iterative fix pattern
> - [Graphite Stack Review](https://graphite.com/docs/best-practices-for-reviewing-stacks) — Cross-PR review best practices
> - [Spec-Test-Lint Workflow](https://adlrocha.substack.com/p/adlrocha-taming-the-agents-my-spec) — Spec-driven drift prevention
> - [CodeRabbit PR Validation](https://docs.coderabbit.ai/changelog) — Ticket misalignment detection, scope alignment
<!-- /deepen-plan -->
