---
title: "Stale Plan Documents Committed After Implementation"
date: "2026-03-07"
category: "code-quality"
track: knowledge
problem: 'Stale Plan Documents Committed After Implementation'
tags:
  - stale-documentation
  - plan-docs
  - ai-generated-plans
  - review-all
  - post-implementation-drift
components:
  - docs/plans/
  - docs/brainstorms/
---

# Stale Plan Documents Committed After Implementation

## Problem

AI-generated plan and brainstorm documents are committed to the repository
*after* the implementation they describe has already shipped to main. The
resulting PRs contain plans with unchecked task boxes, stale codebase
assumptions, and phase descriptions that no longer reflect reality.

This pattern was observed across 4 PRs in a single review-all cycle:

| PR | Stale Content | Reality on main |
|----|---------------|-----------------|
| #145 | 3-phase plan with unchecked task boxes | All 3 phases already implemented (Rules 6-8, hooks.json sync, setup fixes) |
| #144 | Plan for ast-grep integration | PR #138 already shipped the full implementation |
| #141 | Phase 1 (`/linear:work`) and Phase 6 (API URL fix) listed as TODO | Phase 1 merged via PR #127; Phase 6 already resolved |
| #143 | Solution doc written in past tense describing a completed fix | No code changes in the PR -- doc-only with nothing to apply |

The common root cause: an AI agent (e.g., Codex) generates a plan or brainstorm
document, but by the time the plan branch is created and pushed, the actual
implementation has already been completed on a separate branch and merged. The
plan document becomes immediately stale on arrival.

## Detection

### Signal 1: Plan PR with no code changes

If a PR contains only markdown files under `docs/plans/`, `docs/brainstorms/`,
or similar directories, and describes implementation work, check whether that
work already exists on main:

```bash
# List files changed in the PR
gh pr diff <PR_NUMBER> --name-only

# If only .md files, check whether the described implementation exists
# Example: plan describes adding Rules 6-8 to validate-plugin.js
grep -n 'Rule 6\|Rule 7\|Rule 8' scripts/validate-plugin.js
```

### Signal 2: Unchecked task boxes for completed work

Plan documents use `- [ ]` checkbox syntax. If corresponding code already exists
on main, these boxes should be checked or the plan should be marked
retrospective:

```bash
# Count unchecked boxes in a plan doc
grep -c '^\s*- \[ \]' docs/plans/some-plan.md

# Then verify whether each task's deliverable exists on main
```

### Signal 3: Past-tense solution docs with no corresponding diff

A solution document that describes a fix in past tense ("We fixed X by doing Y")
but the PR contains zero code changes means the fix was applied elsewhere. The
doc is a retrospective, not a proposal.

## Root Cause

AI code agents that operate asynchronously (e.g., Codex background tasks) have
no coordination mechanism to detect when another agent or human has already
implemented the planned work. The sequence is:

1. Agent A generates a plan document on branch `plan-feature-x`
2. Agent B (or a human) implements feature X on branch `impl-feature-x`
3. Branch `impl-feature-x` merges to main
4. Branch `plan-feature-x` is pushed -- now the plan describes work that is
   already complete

There is no pre-push hook or CI check that detects "this plan describes work
that already exists on main."

## Fix

When a stale plan PR is discovered during review, choose one of these
dispositions:

### Option 1: Close the PR (preferred for fully stale plans)

If every phase/task in the plan is already implemented on main, close the PR
with a comment explaining what shipped and where:

```
Closing: all phases described in this plan have been implemented.
- Phase 1: merged in PR #127
- Phase 2: merged in PR #138
- Phase 3: merged in PR #140
```

### Option 2: Convert to retrospective

If the plan has value as a design rationale document, update it:

1. Add `status: retrospective` to the frontmatter
2. Check all completed task boxes
3. Add a "Status" section at the top noting which PRs implemented each phase
4. Remove or annotate any codebase claims that no longer hold

### Option 3: Update and keep (partially stale plans)

If some phases are complete but others remain TODO:

1. Check completed task boxes and note the implementing PR
2. Rebase the plan branch on main
3. Verify remaining phases still make sense against current main
4. Update any stale codebase references

## Prevention

### 1. Check main before pushing plan branches

Before pushing a plan document, verify the described work does not already exist:

```bash
# Before pushing a plan that describes adding ast-grep integration
git log --oneline main | grep -i 'ast-grep'
# If hits found, the plan is stale
```

### 2. Add `status:` frontmatter to all plan documents

Require plan documents to declare their status:

```yaml
---
title: "Feature X Plan"
status: draft | active | retrospective | superseded
implemented_by: []  # PR numbers, filled in when work ships
---
```

This makes staleness immediately visible during review.

### 3. Time-box plan PRs

Plan PRs that sit open for more than one sprint are likely to become stale.
Review and close or update them weekly.

### 4. Prefer implementation over plans for small changes

If the implementation is smaller than the plan document that describes it, skip
the plan and implement directly. Plans add value for multi-sprint, multi-author
efforts -- not for single-PR fixes.

### 5. Review-all should flag plan-only PRs

During `/review:review-all`, any PR that contains only documentation under
`docs/plans/` or `docs/brainstorms/` with no code changes should be flagged for
staleness verification before marking as mergeable.

## Related Documentation

- `docs/solutions/code-quality/api-migration-stale-documentation-cascade.md` --
  covers stale *API documentation* after migration changes (different root cause:
  secondary docs not updated when primary patterns change)
- `docs/solutions/code-quality/cross-plugin-documentation-correctness.md` --
  covers incorrect cross-references in documentation (different root cause:
  inferring names from convention rather than reading source)
