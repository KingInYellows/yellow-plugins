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

---

## Update — 2026-07-30

### Record-accuracy review for retrospective plan/handoff docs

PR #681 committed 4 historical planning records (a deferred-design-decisions
plan plus two session handoffs and a brainstorm) written *after* the work
they describe had already shipped across PRs #677-#680. A 9-reviewer pass
found the same failure class this doc already names (Option 2:
"Convert to retrospective") wasn't followed all the way through, in three
concrete ways that are worth adding as explicit checks for any retrospective
plan/handoff PR:

1. **Supersession drift within the document itself.** The plan's Phase 4
   section header and its own task list said "no repo PR / manual dashboard
   only," while a deepen-plan research note *elsewhere in the same file*,
   and the actual shipped fix (PR #680, a committed root `.codacy.yml`),
   said the opposite. The document contradicted itself because an earlier
   research finding overturned the plan-of-record but the headline text was
   never reconciled to match. When a plan's own later section supersedes an
   earlier one, either edit the earlier section in place or add an explicit
   forward-pointer ("see Phase 4 below — resolution differs from what this
   section assumed") — don't leave both stated as if still current.
2. **Missing PR cross-references and status marker.** A fully-checked
   `- [x]` plan reads as "ready to complete" indefinitely unless it also
   states *which PR* resolved each item and carries a status header noting
   the record is a point-in-time snapshot, not living process. Add a status
   line at the top (e.g. `> **Status: point-in-time record — all tasks
   complete.** Implemented by: Phase 1 → PR #677, Phase 2 → PR #678, ...`)
   so the checkbox state is traceable to evidence instead of just asserted.
3. **Trailers/Open-decisions sections framed resolved items as still open.**
   Handoff "Open decisions" and PR trailers described items that the
   co-committed plan had already closed out, because the handoff was
   drafted before the plan's final revision and never re-synced. Add
   forward pointers ("see plan X, item Y — resolved") or a `SUPERSEDED`
   marker rather than leaving stale open-question framing in a document
   committed alongside its own resolution.

**Rule:** when committing a plan or handoff as a retrospective record (not a
live TODO), treat it as a mini-audit: reconcile every internal
contradiction between an earlier section and a later correction, add PR
cross-references next to every checked box, and mark any "open question"
section that the co-committed material has already answered. A
fully-checked plan with no PR trail and no supersession markers is not
distinguishable from "still in progress" months later.

**Prevention checklist additions:**

- [ ] Grep the retrospective doc for count/date/status mentions that
      appear in more than one place (e.g. "N phases", "no repo PR") and
      confirm every occurrence agrees with the final resolution — a
      deepen-plan correction applied to one paragraph but not to the
      summary line at the top is the single most common instance of this
      failure.
- [ ] Every `- [x]` in a plan being committed retrospectively should be
      traceable to a PR number, either inline or via a status header
      mapping phases to PRs.
- [ ] Before committing a handoff alongside the plan it hands off from,
      re-read the handoff's "Open decisions"/trailers section against the
      plan's final state — anything the plan already resolved needs a
      forward pointer or `SUPERSEDED` marker, not to be left reading as
      open.

See also `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
anti-pattern #32 — a related but distinct failure from the same PR, about
re-verifying reviewer-supplied "verified" commit-hash citations directly
rather than trusting the label.
