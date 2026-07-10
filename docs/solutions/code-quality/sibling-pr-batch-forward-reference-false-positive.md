---
title: "Sibling-PR batch forward-reference false positives"
date: "2026-07-09"
category: code-quality
track: knowledge
problem: "Reviewers flag valid forward refs to a sibling PR's not-yet-merged deliverable as dangling/404/premature"
tags:
  - multi-agent-review
  - false-positives
  - pr-review
  - review-triage
  - sibling-pr
  - forward-reference
  - sweep-all
components:
  - yellow-review
  - workflow
related:
  - docs/solutions/workflow/rebase-stale-findings-and-merge-misframing.md
  - docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md
  - docs/solutions/code-quality/automated-bot-review-false-positives.md
---

# Sibling-PR batch forward-reference false positives

## Context

When `/review:sweep-all` (or any batch review) processes several sibling PRs
opened off the same trunk in one audit or stack, each reviewer — in-house
personas and external bots alike (gemini, cubic, coderabbit, chatgpt observed)
— evaluates its assigned PR in isolation, scoped to that PR's own diff and repo
state. A reference inside the PR that points at a deliverable living in a
*different, not-yet-merged sibling PR* (a doc cross-link, a plan checkbox, a
"Sibling of `<file>`" note) has no referent from the reviewer's vantage point.
It reads as broken, premature, or fabricated — even when it is a correct
forward reference that will resolve the moment the sibling merges.

## Guidance

Before accepting a "dangling / 404 / premature / undelivered reference" finding
on a PR known to be part of a sibling batch:

1. Identify the sibling PR(s) the reference plausibly targets from the batch
   list (e.g. `#628`-`#636`).
2. Verify empirically — do not take the reviewer's isolated view at face value:
   `gh pr view <sibling-pr-number> --json files` (or
   `gh pr diff <sibling> --name-only`) against each candidate.
3. **This check must be able to fail.** If no sibling delivers the referent,
   the finding is genuine — fix it normally. The lesson is "verify sibling
   delivery before declining," not "always decline sibling-batch findings."
4. If a sibling does deliver it: decline the revert/removal and resolve by
   confirming **merge order** (the sibling must land at or before the
   referencing PR), not by editing the reference reactively.
5. Never "fix" a valid forward reference by turning it into a clickable
   markdown link before the sibling merges — that trades a false-positive
   finding for a live 404.
6. If the referencing PR is the sole owner/editor of a shared artifact (e.g. a
   plan file with checkboxes), prefer decline + a clarifying note over moving
   state into the sibling PR — cross-PR edits to the same shared file create
   3-way merge conflicts.
7. Record the sibling-batch context (which PR delivers which file) in the review
   response so the next reviewer/bot pass does not re-flag it cold.

## Why This Matters

Convergent agreement across many reviewers is not independent confirmation
here — every reviewer (five on one instance below) shares the identical blind
spot of only seeing its own PR's diff, so consensus can be manufactured by the
review architecture itself, not by the finding being real. Treating it as real
risks doing active harm: reverting can permanently understate progress on a PR
that is the sole editor of a tracking file, moving state to the sibling creates
merge conflicts, and linkifying a forward reference creates a live 404 until the
sibling lands.

## When to Apply

- The PR under review is one of several sibling PRs opened off the same trunk in
  a single sweep or audit batch.
- A finding uses language like dangling / 404 / premature / undelivered / broken
  reference, targeting a doc, plan checkbox, or cross-link.
- Multiple reviewers (personas and/or bots) converge on the same claim.

## Examples

**PR #634** (2026-07-09, marketplace-audit batch `#628`-`#636`): plan checkboxes
5.1/5.2 were ticked in the plan-owning PR, naming docs actually delivered by
sibling PRs #635/#636. `architecture-strategist`, `correctness-reviewer`, and
cubic flagged this as premature. `gh pr view` on #635/#636 confirmed the docs
are there. Declining the revert and adding a clarifying note was correct —
reverting would have permanently understated progress (sole plan-file editor),
and moving the ticks to the siblings would 3-way-conflict the shared plan file.

**PR #636**: a line reading "Sibling of
`docs/review-surface-routing-protocol.md`" was flagged as a dead reference by
five reviewers (`comment-analyzer`, `correctness-reviewer`,
`project-compliance-reviewer`, `project-standards-reviewer`, cubic). That file
is delivered by sibling PR #635 (changeset named `post-stack-...`, branch live).
Declining removal was correct — confirming merge order was the fix, not editing
the reference.

```bash
# Verify a sibling PR actually delivers the referenced file
gh pr view 635 --json files --jq '.files[].path' | grep -F 'review-surface-routing-protocol.md'
```
