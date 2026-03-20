# Brainstorm: Session-Level Review with Autonomous Fix Loop

## What We're Building

Transform `workflows:review` from a thin redirect to `review:pr` into a
session-level review command that evaluates work across three dimensions:

1. **Plan adherence** -- Compare completed PRs against the original plan file.
   Identify tasks that were skipped, acceptance criteria that are unmet, and
   implementation that diverged from the documented approach.

2. **Cross-PR coherence** -- Detect inconsistencies across PRs in the session:
   conflicting naming conventions, duplicated logic across branches, broken
   import chains between stacked PRs, and divergent patterns where the same
   problem is solved differently in different PRs.

3. **Scope drift** -- Flag work that was not in the plan. AI-assessed: if the
   drift appears intentional (e.g., a necessary refactor discovered during
   implementation), it is documented as a justified divergence. If unintentional
   (e.g., gold-plating, tangent features), it is flagged for removal or
   deferral.

After identifying issues, the command autonomously invokes `workflows:work` to
fix them -- no user confirmation required. This creates a closed
review-then-fix loop that catches and corrects session-level problems before the
user reviews the final result.

**Output:** Both an inline summary printed to the user and an optional
persistent review doc written to disk.

**Excluded from scope:** Session retrospective / knowledge compounding (handled
by `workflows:compound`). Per-PR code quality review (handled by `review:pr`,
which already runs as Phase 5 of `workflows:work`).

## Why This Approach

The current `workflows:review` is a redirect to `review:pr`, which operates at
the individual PR level. It catches code-level issues (security, simplicity,
test coverage) but cannot detect session-level problems: a plan that was only
partially implemented, PRs that contradict each other, or scope that expanded
beyond what was planned. These problems are only visible when looking across the
full session.

The autonomous fix loop is the key differentiator. A review that reports
problems but requires the user to manually invoke fixes adds friction and breaks
flow. By having `workflows:review` produce a structured remediation plan and
feed it directly to `workflows:work`, the entire review-fix cycle happens
without interruption. The user sees the final state: "I found 3 issues and
fixed all 3."

This follows the same pattern as `review:pr` Steps 6-8 (apply P1/P2 fixes
automatically, commit, push) but elevated to the session level. The difference
is that session-level fixes may require modifying code across multiple PRs
rather than within a single diff.

## Key Decisions

### 1. Architecture: Two-phase with remediation plan (Approach B)

Three approaches were evaluated:

#### Approach A: Monolithic Review-Fix Command

The review command itself contains all fix logic. It identifies issues, then
immediately edits files to fix them, commits, and pushes -- all within a single
command execution.

**Pros:**
- Simplest implementation -- single command, no inter-command protocol
- No intermediate artifacts (remediation plan file)
- Full context available when fixing (reviewer knows exactly what it found)

**Cons:**
- Duplicates implementation logic already in `workflows:work`
- Cannot leverage `workflows:work`'s existing branch management, test execution,
  commit conventions, and quality checks
- Fix logic would need to handle both single-branch and stacked-PR topologies
  independently
- Violates the existing separation of concerns: review commands review, work
  commands implement

**Best when:** The fix loop is simple (e.g., only text changes, no cross-PR
coordination needed).

#### Approach B: Two-Phase Architecture (Recommended)

Phase 1 (review) produces a structured remediation plan. Phase 2 invokes
`workflows:work` with that plan via the Skill tool. The remediation plan uses
the same format as regular plan files so `workflows:work` can consume it without
modification.

**Pros:**
- Reuses all `workflows:work` infrastructure: branch management, incremental
  commits, test execution, quality checks, stack awareness
- Clean separation: review identifies problems, work fixes them
- Remediation plan is inspectable -- user can read it to understand what will
  change
- Naturally supports cross-PR fixes via stack-aware execution
- The Skill tool invocation pattern is already established (used by
  `workflows:plan` to call `workflows:work`)

**Cons:**
- Requires a well-defined remediation plan format
- Adds an intermediate artifact (plan file) that must be cleaned up
- Slightly more complex orchestration than monolithic approach
- `workflows:work` asks clarifying questions in Phase 1 -- the remediation plan
  must be unambiguous enough to avoid interactive prompts during autonomous
  execution

**Best when:** Fixes span multiple files or PRs, existing `workflows:work`
patterns should be reused, and inspectability of the fix plan matters.

#### Approach C: Lint-Style Checker with Manual Fix

The review command reports findings but does not fix anything. The user manually
runs `workflows:work` with the review output or fixes issues by hand.

**Pros:**
- Lowest risk -- review is read-only, no autonomous changes
- User maintains full control
- Simplest to implement (no fix loop at all)

**Cons:**
- Directly contradicts the requirement for autonomous fixing
- Adds friction: user must read findings, decide which to fix, then manually
  invoke fixes
- Loses the closed-loop benefit that makes session-level review valuable

**Best when:** The organization requires human approval for all changes (not the
case here).

**Decision: Approach B.** It reuses `workflows:work` without duplication,
supports cross-PR fixes naturally, and produces an inspectable remediation plan.
The Skill tool invocation pattern is proven.

### 2. How workflows:work accepts the remediation plan

`workflows:work` accepts a plan file path as its sole argument
(`#$ARGUMENTS`). It reads the file, parses tasks, and executes them. The
remediation plan must conform to the same markdown structure that `workflows:work`
already parses:

```markdown
# Remediation: Session Review Findings

## Overview

Fixes for [N] issues found by session-level review.

## Implementation Plan

### Phase 1: Plan Adherence Fixes

- [ ] Task 1.1: Implement missing acceptance criterion X
- [ ] Task 1.2: Add skipped test for feature Y

### Phase 2: Coherence Fixes

- [ ] Task 2.1: Align naming convention in branch-A to match branch-B
- [ ] Task 2.2: Extract duplicated validation logic to shared module

### Phase 3: Scope Corrections

- [ ] Task 3.1: Remove gold-plated feature Z (not in plan)
- [ ] Task 3.2: Move tangent refactor to follow-up issue

## Acceptance Criteria

- All plan tasks marked complete or justified as deferred
- No cross-PR naming or pattern inconsistencies
- No unintentional scope additions remain
```

This means `workflows:work` requires zero changes. The remediation plan is
just a plan file.

### 3. Preventing infinite review-fix-review loops

The autonomous loop must terminate. Three mechanisms:

1. **Max iteration cap: 2 cycles.** The review-fix loop runs at most twice.
   After the second fix pass, any remaining issues are reported to the user
   rather than triggering a third cycle. This prevents pathological cases where
   a fix introduces a new issue that triggers another fix.

2. **Monotonic progress check.** After each fix cycle, the review re-runs and
   compares the issue count to the previous round. If the count did not
   decrease (fixes created as many problems as they solved), the loop stops and
   reports to the user.

3. **Severity floor.** Only P1 (must-fix) issues trigger the autonomous fix
   loop. P2 (should-fix) and P3 (nice-to-have) issues are reported but not
   auto-fixed. This limits the scope of autonomous changes and avoids
   subjective fixes that might introduce new problems.

### 4. Skill tool invocation for the fix loop

The invocation follows the established pattern from `workflows:plan`:

```
Invoke the Skill tool with skill: "workflows:work" and args set to the
remediation plan file path.
```

The Skill tool call is autonomous -- no `AskUserQuestion` before invocation.
This matches the user's requirement for fully autonomous fixing. The only user
interaction is the final summary after all cycles complete.

### 5. Session context: how to identify "session PRs"

The review command needs to know which PRs belong to the current session. Three
sources, checked in order:

1. **Plan file reference.** If `$ARGUMENTS` includes a plan file path, read the
   plan's `## Stack Decomposition` or `## Stack Progress` sections to identify
   session branches. This is the most reliable source.

2. **Graphite stack.** Run `gt log short --no-interactive` to get the current
   stack. All branches in the stack are considered session PRs.

3. **Current branch only.** If neither of the above yields multiple PRs, fall
   back to reviewing only the current branch against the plan.

### 6. Output format: inline summary + optional persistent doc

The review always prints an inline summary with a structured table:

```
Session Review: 3 issues found, 3 fixed (2 cycles)

| # | Dimension      | Issue                              | Status |
|---|----------------|------------------------------------|--------|
| 1 | Plan adherence | Missing test for auth middleware    | Fixed  |
| 2 | Coherence      | Inconsistent error format in PR #4 | Fixed  |
| 3 | Scope drift    | Unrequested logging abstraction    | Fixed  |
```

Optionally, a persistent review doc is written to
`docs/reviews/YYYY-MM-DD-<slug>-session-review.md` if any P1 issues were found
or if the user requests it. The review doc includes the full findings, the
remediation plan, and the resolution status.

### 7. Drift classification: AI-assessed with structured output

Scope drift is assessed per change (file or logical unit) against the plan:

- **In plan:** Change directly corresponds to a plan task. No action needed.
- **Justified divergence:** Change is not in the plan but is a reasonable
  consequence of implementation (e.g., fixing a bug discovered during feature
  work, refactoring a file that needed to change anyway). Documented in the
  review summary with rationale. Not auto-fixed.
- **Unintentional drift:** Change is not in the plan and cannot be justified as
  a necessary consequence. Flagged for removal or deferral. Auto-fixed by
  reverting the change or moving it to a separate branch.

The AI classification uses the plan file as the source of truth. If no plan file
is available, scope drift analysis is skipped (there is nothing to drift from).

### 8. Backwards compatibility

The new `workflows:review` retains its redirect behavior as a fallback:

- **With plan file argument:** Runs session-level review with the full
  three-dimension analysis and fix loop.
- **With PR number/URL/branch argument (no plan file):** Redirects to
  `review:pr` as it does today. This preserves the existing user experience for
  ad-hoc PR reviews.
- **With no arguments and no plan context:** Attempts to detect session context
  from the Graphite stack. If a plan file can be inferred (e.g., from the
  branch name or recent `plans/*.md` files), runs session-level review.
  Otherwise, falls back to `review:pr` on the current branch.

## Open Questions

- **Cross-PR fix mechanics.** When a coherence issue spans two PRs (e.g.,
  inconsistent naming in branch-A and branch-B), `workflows:work` operates on
  one branch at a time. Should the remediation plan include explicit branch
  checkout instructions, or should the review command handle branch switching
  and invoke `workflows:work` once per branch? The latter is simpler but means
  multiple Skill invocations.

- **Remediation plan cleanup.** The intermediate remediation plan file
  (`plans/remediation-<timestamp>.md`) is useful for debugging but could
  accumulate. Should it be auto-deleted after successful fixes, kept for a
  configurable retention period, or always kept? Leaning toward keeping it
  (inspectability) and letting the user clean up manually.

- **Integration with workflows:compound.** After a review-fix cycle, the
  findings might be worth compounding. Should `workflows:review` automatically
  invoke `workflows:compound` at the end, or leave that to the user? The current
  design leaves it to the user to avoid scope creep, but the data is right
  there.

- **P2 auto-fix opt-in.** The current design only auto-fixes P1 issues. Should
  there be a flag (`--fix-p2` or an `AskUserQuestion` at the end) to also fix
  P2 issues? This could be added later without architectural changes.

- **Performance on large sessions.** A session with 5+ stacked PRs could produce
  a large combined diff. The review agents need to process all PRs' diffs
  together for cross-PR coherence analysis. May need to batch or summarize
  diffs for very large sessions.

## Dialogue Log

### Prior session context

This brainstorm continues from a prior conversation where the following was
established through Q&A:

- **Topic confirmed:** Transform `workflows:review` from a redirect into a
  session-level review
- **Three review dimensions:** Plan adherence, cross-PR coherence, scope drift
- **Excluded:** Session retrospective (handled by `workflows:compound`)
- **Drift handling:** AI-assessed -- intentional divergence explained,
  unintentional flagged
- **Output format:** Both inline summary + optional persistent doc

### New requirement added this session

**Autonomous fix loop:** After review identifies issues, automatically re-invoke
`workflows:work` to fix them. Fully autonomous, no user confirmation needed.

### Codebase research findings

Research into the codebase revealed:

- `workflows:work` accepts a plan file path as `$ARGUMENTS` and parses standard
  markdown plan format (Overview, Implementation Plan with tasks, Acceptance
  Criteria). No changes needed to consume a remediation plan.
- The Skill tool pattern for cross-command invocation is established:
  `workflows:plan` calls `workflows:work` via `skill: "workflows:work"` with
  args set to the plan file path.
- `workflows:work` has interactive prompts (AskUserQuestion in Phase 1 step 3
  for ambiguities, step 5 for branch decisions). The remediation plan must be
  precise enough to avoid triggering these prompts.
- `review:pr` already applies P1/P2 fixes and commits them autonomously (Steps
  6-8). The session-level review extends this pattern to cross-PR scope.
- `workflows:compound` is a separate command for knowledge extraction. The
  session review should not duplicate its responsibilities.
- Stack-aware execution in `workflows:work` (Phase 1b) supports both linear and
  parallel topologies via `## Stack Decomposition`. Remediation plans could
  leverage this for multi-branch fixes, but single-branch remediation is
  simpler for v1.
