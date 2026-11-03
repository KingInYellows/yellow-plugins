# Report-only mode — `/review:pr --report-only`

Loaded by `/review:pr` Step 1 when `--report-only` is set. The review produces
the same findings as a normal run and leaves the caller's checkout exactly as it
was: same `git status`, same HEAD, same branch. Nothing is edited, committed,
pushed or compounded. The Step 6 ledger write still runs, so `/review:sweep` and
`/review:triage` see the findings as pending.

## Replace Steps 2 and 3's checkout

Skip Step 2's clean-tree check and Step 3's stack-provider router and checkout.
Run the Step 3 `gh pr view` for metadata as usual, then:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/report-only-root" open <PR#>
```

It prints `mode=`, `review_root=` and `head=`. Record all three.

- `mode=in-place`: HEAD already is the verified PR head and the tree is clean,
  so the review reads the current checkout.
- `mode=worktree`: the script added a detached worktree of the PR head under the
  git common dir. It has its own HEAD and index, so the caller's checkout is
  untouched, and it shares the object store and the review-findings ledger.
- Exit 3: the PR head could not be verified (shallow clone, fetch failure, a
  push mid-check). Report
  `[review:pr] Error: report-only could not fetch the PR head; nothing changed`
  and stop. Any other non-zero exit: report its stderr and stop.

## Run every later step from the review root

Start every later Bash call of this review with `cd '<review_root>' || exit 1`,
substituting the recorded path. Then `HEAD` in Steps 3a to 6 (the risk
classifier, `file-line-counts`, the ledger's head check, the workflow shadow) is
the PR head in both modes, and no step needs its own variant.

Steps 3d and 5 give reviewers the diff in their prompt. In `worktree` mode, add
one line after each reviewer's pr-context fence:
`Read changed files under <review_root>; that directory is the PR head.`

Step 4 reads `yellow-plugins.local.md`. In `worktree` mode, read it from the
directory the review started in, not from `<review_root>`: the file is usually
untracked, so the worktree does not have it.

## Skip Steps 7 to 9b

Skip fix application, the code-simplifier pass, commit and push, and knowledge
compounding. Findings Step 7 would have applied stay in their severity tables
with their route; they are not moved to Residual Actionable Work. Step 10's
Applied Fixes section is the single line `report-only: none applied`, and
Coverage gets `- Mode: report-only (<mode>)`.

## Cleanup

In `worktree` mode, run this once before Step 10 and on every other path that
ends the review after `open` succeeded. Run the workflow shadow's own Cleanup
first when it ran, because its checkout was made from this one's HEAD. Run it
from the directory the review started in, not from `<review_root>`:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/report-only-root" close '<review_root>'
```

It removes only a worktree the script made and refuses anything else (exit 2),
so a mistyped path cannot delete the caller's checkout. In `in-place` mode there
is nothing to clean up; never call `close` on an `in-place` root.
