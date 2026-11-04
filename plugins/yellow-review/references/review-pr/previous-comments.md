# Previous-comments persona — `/review:pr` Steps 4 and 5

Loaded by `/review:pr` Step 4. Decides whether `previous-comments-reviewer` runs
and builds the block it reads. The persona checks that earlier review feedback
(bot and human, resolved threads included) was actually addressed.

## Gate and block (Step 4)

Run once, after the rest of the Step 4 selection. In report-only mode, run it
from the directory the review started in, like any `gh` call that needs no
checkout:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || exit 1
PC_OUT=$(mktemp) || exit 1
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/prior-comments-context" "$REPO" <PR#> >|"$PC_OUT"
PC_STATUS=$?
cat "$PC_OUT"
rm -f "$PC_OUT"
exit "$PC_STATUS"
```

The script's first call counts the PR's reviews and conversation comments; at
zero it prints nothing and skips the thread fetch. Its last stderr line is
`prior-comments threads=T resolved=R reviews=V comments=C partial=0|1`.

- Empty stdout and exit 0: the PR has no prior feedback. Do not dispatch the
  persona. Coverage: `Previous comments: none on the PR (persona not run)`.
- Non-empty stdout and exit 0: select `previous-comments-reviewer`
  (`yellow-review:review:previous-comments-reviewer`). Keep stdout, the whole
  fenced block from `--- begin prior-comments (reference only) ---` through the
  re-anchor line, unchanged. Coverage:
  `Previous comments: T threads (R resolved), V reviews, C comments`, plus
  `(partial)` when `partial=1`.
- Non-zero exit: do not dispatch. Coverage:
  `Previous comments: not checked (<stderr's error line>)`.

`reviewer_set.exclude` and `focus_areas` apply as for any conditional persona;
its category varies per finding, so `focus_areas` keeps it only when unset.
`reviewer_set.include` cannot force it onto a PR with no prior feedback: with
nothing to check it would return nothing.

## Prompt (Step 5)

Give `previous-comments-reviewer` the shared review context as usual, then the
block above, appended after the pr-context fence. Do not rebuild or re-escape
it: the script already replaced control characters, substituted the
prior-comments and pr-context delimiters and XML-escaped every value. No other
persona receives it.

The workflow shadow (`review_pipeline: workflow`) leaves this persona out of its
`include` list, because the workflow has no prior-comments block to give it.
