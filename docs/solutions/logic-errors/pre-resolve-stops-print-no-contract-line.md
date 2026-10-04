---
title: 'A fail-closed caller halts the batch when a benign skip prints no contract line'
date: 2026-10-03
category: logic-errors
track: bug
problem: 'sweep-all treats a missing Resolve line as a stop, so a closed-PR or dirty-tree skip before /review:resolve halts the whole batch'
tags: [review-sweep, resolve-contract, fail-closed, exit-codes, silent-failure, yellow-review]
components: [yellow-review]
---

## Problem

Point-in-time findings on the unmerged PR #955 head (`b7f02a7d`), which makes
`/review:resolve-stack` and `/review:sweep-all` stop on a dirty tree and read
the `Resolve:` contract line. Paths and line numbers come from the review
table and may move before merge; re-read the files before relying on them.

This doc covers only the producer-side obligation that the existing resolve
docs leave out. Already covered elsewhere, not repeated here:

- Ignored-file blind spot of `git status`: `docs/solutions/security-issues/resolver-guards-trust-prompt-and-git-status-only.md`
- `stopped=` field, unknown scope, tool-state writes: `docs/solutions/logic-errors/resolver-unknown-scope-and-guard-misfires.md`
- Unpublished restack, frozen ranges: `docs/solutions/logic-errors/resolve-stack-state-stale-after-fix-commit-push.md`
- Structured field beats text heuristics: `docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`
- One copy of each rule, stale prose sweep: `docs/solutions/code-quality/state-rules-once-and-update-unwired-prose.md`

## Symptoms

- **Benign skip halts the batch (P1, 11 reviewers).** The new caller rule
  says a missing `Resolve:` line is a stop. A sweep that ends before
  `/review:resolve` runs (PR closed, dirty tree, branch mismatch) never reaches
  the command that prints the line. `sweep-all` read no contract and halted
  every remaining PR with exit 1, although each of those exits is a skip.
- **Rule contradicts itself (P2).** Error Handling in `resolve-stack` said a
  closed PR is skipped, while the new rule made the same case a stop.
- **Error stop reads like a clean run (P2, 4 reviewers).** With no
  discriminator on the line, a stop for an error and "nothing to do" printed
  alike. The `stopped=` fix is in the doc linked above.
- **Failure reads as the benign state (P2).**
  - A failed `git status` was treated as a clean tree.
  - A failed revert was found by matching free text after exit 0.
  - `pr-changed-ranges` dropped unsafe file names with no count or marker.

## What Didn't Work

- Adding "missing contract is a stop" to the caller alone. The rule was right
  for a resolve that crashed, and wrong for exits that never invoke resolve.
- Writing "every stop prints the Resolve line" in the preamble. The pre-resolve
  exits are not in resolve's control flow, so the claim was false from the
  start.
- Reading a substring of resolver prose as proof of a failed revert.

## Solution

1. **Enumerate every exit of the producer before making absence an error.**
   List the paths that end before the contract-printing command, and give each
   one a terminal line of its own. Use one distinct line for pre-resolve
   stops, mapped by the caller to `skipped` (batch continues), separate from
   the error stops that map to exit 1.
2. **State the non-open-PR stop once**, in the contract, and have
   Error Handling point at it. Do not restate whether a closed PR skips or
   stops in each command.
3. **Treat a non-zero `git status` as a dirty tree with unknown contents**,
   which stops, never as clean.
4. **Return the revert result as a structured field** (`revertComplete` or
   similar) and read that, not text after exit 0.
5. **Report dropped inputs.** When a script discards names it cannot handle,
   print a count on stderr or emit an `unknown` row, so a missing path cannot
   look like a path with no change.

## Why This Works

A caller that fails closed on absence is only correct if every producer path
that legitimately says nothing also says something. A distinct skip line keeps
the absence rule meaningful: absence then means the producer crashed or was
never reached, not that it chose to skip. The same shape applies to a failed
`git status`, a failed revert and a dropped file name: each is a failure that
the consumer would otherwise read as the quiet, benign answer.

## Prevention

- When a PR makes a missing line an error, test one run per non-resolve exit
  (closed PR, dirty tree, branch mismatch) and assert the batch continues with
  a skip, and one run where resolve crashes and assert it stops.
- Before writing a universal claim in a preamble ("every stop prints X"), list
  the exits it covers; scope the claim or make it true.
- For each guard that reads a tool's output, add a test where the tool itself
  fails, and assert the result is the cautious state.
- Prefer a structured field over matching message text; free text rewords.
