---
title: 'Destructive helpers check before they act; fail-closed leftovers and empty-log assertions need a second guard'
date: 2026-10-03
category: code-quality
track: knowledge
problem: council cleanup helper rm -rf ran before its shape check, fail-closed state leftovers blocked reruns, bats assert passed on an empty log
tags: [shell, cleanup, fail-closed, bats, vacuous-assertion, fallback-parser, yellow-council, yellow-research]
components: [yellow-council, yellow-research, yellow-devin, yellow-semgrep]
---

## Context

Point-in-time findings on PR #984 (open and unmerged), head `a7ca7d41`. Line
numbers are omitted on purpose; locate each item by the named function or
step. Re-verify against the merged code before relying on any claim here.

The PR's review also found the rule-contradicted-by-table pattern and the
relayed-literal and Write-forgery residuals. Those are already covered by
[state-rules-once-and-update-unwired-prose](state-rules-once-and-update-unwired-prose.md),
[shell-owned-state-is-not-a-boundary-against-write](../security-issues/shell-owned-state-is-not-a-boundary-against-write.md)
and [bats-negated-grep-mid-test-never-fails](bats-negated-grep-mid-test-never-fails.md).
This doc records only the patterns they do not.

## Guidance

1. **Check the shape before the first destructive call, not only on the
   retry.** `council_rm_synth_dir` in `council.md` (Step 5a's sweep) ran
   `rm -rf -- "$d"` first and applied the `/tmp/council-synth-*`, no-`..`,
   not-a-symlink, owned-by-us checks only before its `chmod -R` retry.
   Callers pre-check today, so no bug is reachable, but the helper's own
   guarantee is weaker than its comment. Put the `case` and `[ -d ] && [ ! -L ]
   && [ -O ]` guard at the top, then `rm -rf`, then the permission retry.
2. **A fail-closed delete still leaves state behind.** The Step 8 Cancel
   block sets `SYNTH_OWN_DIR="<literal COUNCIL_SYNTH_DIR value from 5a>"`; an
   unsubstituted placeholder never equals the state file's first line, so the
   unlink refuses. That is the right failure for the delete, but the state
   file then stays and blocks the next `/council` until the 24-hour reclaim.
   The fence's prose must tell the model to substitute the value, and the
   refusal should print a note naming the leftover. When a guard fails
   closed, ask what the failure leaves on disk and who will see it.
3. **A fallback parser must claim only what its shape handles.** The jq-less
   branch of `has_userconfig` (research, devin and semgrep `setup`) matches
   `"<plugin>": { [^{}]* "<option>": "<non-empty>"`. `[^{}]*` cannot cross a
   nested object that precedes the option, so a miss is possible, yet the
   comments called it definitive and the warning says "false positives"
   when the realistic error is a false negative. A comment also still
   described the old `grep -qF` fallback while the code uses `grep -qE`.
   Describe the fallback as best-effort, name its direction of error, and
   update every copy's comment together. Copies tied by a "keep in step"
   comment and a drift test drift anyway; prefer one sourced lib per plugin.
4. **Assertions that loop over a recorded set pass on an empty set.**
   `assert_made_dirs_gone` in `tests/synthesis.bats` reads `$MADE_DIRS` with
   `while read ... done < "$MADE_DIRS"`. If the recorder never ran (a renamed
   `mktemp` wrapper, a fence that stopped early), the loop body never runs and
   the assert passes. Assert the log is non-empty first:
   `[ -s "$MADE_DIRS" ] || { echo "recorder log empty"; return 1; }`.

## Why This Matters

Each item is a guarantee that reads stronger than it is: a helper that
validates after acting, a refusal that hides its leftover, a fallback that
claims to match the primary path, and a test that asserts nothing when its
input is empty. Reviewers found them by reading, not by a validator.

## When to Apply

- Writing or reviewing any shell helper that deletes (`rm -rf`, `chmod -R`).
- Adding a no-`jq` or regex fallback beside a `jq` path.
- Writing a bats helper that iterates over a log, list or glob.
- Adding a command fence that depends on a model-relayed literal.

## Examples

Reported in the same review and not verified here: 5b, 5d and 5e compared the
state file's directory with itself, so a resumed run after a reclaim was not
bound to this run's claim (the fix is to take `SYNTH_OWN_DIR` in 5d/5e as 5e's
cleanup does). Confirm against the merged `council.md` before acting on it.
