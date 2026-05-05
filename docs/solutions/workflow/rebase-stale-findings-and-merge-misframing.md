---
title: 'Rebase-stale review findings and PR-behind-main merge misframing'
date: 2026-05-04
category: workflow
track: knowledge
problem: 'Multi-agent review flags findings already fixed on main (rebase-stale FPs); "PR behind main" misread as destructive merge threat'
tags: [multi-agent-review, false-positives, rebase, merge, git, pr-review, review-triage]
components: [yellow-review, yellow-ci, workflow]
---

## Context

When a PR branch has diverged from main, multi-agent reviewers operate on the PR
branch's snapshot. Two recurring misdiagnoses emerge from this state:

1. **Rebase-stale false positives** — a reviewer flags a finding that was already
   fixed on main (in a commit that landed after the PR branch was cut).
2. **Merge misframing** — a reviewer or contributor describes "PR behind main" as
   "merge would delete files added on main," treating git's 3-way merge as
   destructive.

Both are process errors, not code errors. Neither requires a code fix on the PR
branch.

## Guidance

### Detecting rebase-stale findings

A finding is rebase-stale when:

- The reviewer cites a specific line or pattern (e.g. "2-segment `subagent_type`
  at `review-pr.md:184`")
- The same file on `main` already has the corrected form
- The fix on main landed in a PR that merged **after** the current PR branch was
  cut

Detection steps:

```bash
# 1. Find the cited file on main
git show main:<path/to/file> | grep -n '<cited pattern>'

# 2. If the pattern is absent on main, the fix is already there
# 3. Confirm which PR introduced the fix
git log main --oneline -- <path/to/file> | head -5
```

If the fix is already on main, suppress the finding as **FP: auto-resolved by
merge**. No action needed on the PR branch — the 3-way merge will bring the
corrected version forward.

**Example from PR #254:** `yellow-review/commands/review/review-pr.md:184` was
flagged for a 2-segment `yellow-core:knowledge-compounder` subagent_type. Main
already had the 3-segment fix (`yellow-core:workflow:knowledge-compounder`) from
PR #290. The finding was a true positive against the PR branch snapshot but a
false positive against the merged result.

### Severity classification

Rebase-stale findings should be suppressed entirely, not downgraded to P2/P3.
The finding does not exist in the post-merge codebase. Including it in the review
summary inflates the finding count and can trigger unnecessary follow-up work.

Mark as: `Suppressed (FP) — auto-resolved by merge`.

### PR-behind-main: what git 3-way merge actually does

Git's 3-way merge computes the diff from the merge base to each tip independently.
Files added on `main` after the PR branch was cut are **not present in the merge
base** and **not touched by the PR branch** — so the merge algorithm carries them
forward untouched into the result. They are never deleted.

The only scenario where a file added on main could be lost is a force-push that
rewrites the main branch history — which is separately blocked by branch protection.

**Correct framing of "PR behind main":**

| Incorrect | Correct |
|---|---|
| "Merge would delete files added on main" | "Merge is safe; files added on main are carried forward" |
| "Rebase is required to avoid data loss" | "Rebase is recommended for a clean history, not for safety" |
| "PR branch is out of date — do not merge" | "PR branch is behind; merge is safe; rebase is optional" |

Rebase is still worth recommending — it reduces noise in the merge commit and
catches conflicts earlier — but the recommendation should be framed as a
**hygiene preference**, not a safety requirement.

**Example from PR #254:** The plugin-contract reviewer stated "merge would
integrate cleanly but rebase recommended" — this is the correct framing. The
misframing ("merge would delete") was a separate reviewer's error that was
corrected during triage.

## Why This Matters

Both errors waste triage time and can cause real harm:

- A rebase-stale FP treated as a real finding generates a follow-up todo that,
  when investigated, discovers the fix already exists — wasted cycles.
- A merge-misframing treated as a safety issue can block a ready PR or trigger
  an unnecessary rebase that introduces conflicts that didn't exist before.

In a multi-agent review with 5+ reviewers, the noise floor from rebase-stale
findings can be significant on any PR that has been open for more than a few days
while main moves forward.

## When to Apply

Apply this triage pattern whenever:

- A review finding cites a line number or symbol name and that finding seems
  inconsistent with what you know about the codebase
- A reviewer uses the word "delete" or "overwrite" in the context of a PR that
  is merely behind main
- The PR branch has diverged from main by more than 1–2 commits (common on PRs
  that went through multiple review rounds)

## Examples

### Rebase-stale suppression (PR #254)

```text
| Suppressed (FP) | project-compliance | plugins/yellow-review/commands/review/review-pr.md:184 |
| 2-segment `yellow-core:knowledge-compounder` would silently fail |
| FALSE POSITIVE: main already has 3-segment fix (PR #290); auto-resolved by merge |
```

### Correct merge-framing language

```text
# Bad
"The PR branch is behind main — merging now would delete the files added
in PR #290. Rebase is required."

# Good
"The PR branch is behind main. A rebase is recommended for a clean history,
but the merge is safe — files added on main since branching will be carried
forward by the 3-way merge."
```

### Quick verification

```bash
# Verify a cited fix is already on main
git show main:plugins/yellow-review/commands/review/review-pr.md \
  | grep -n 'knowledge-compounder'

# Show the merge base to understand divergence
git merge-base HEAD main | xargs git log --oneline -1
```
