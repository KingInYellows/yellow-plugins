# review-gate shadow run — `/review:pr` Step 4

Loaded by `/review:pr` Step 4 only when `yellow-plugins.local.md` sets
`review_pipeline: workflow`. The persona pipeline runs exactly as it does under
`persona`; this file adds one run of the plugin's `review-gate` workflow beside
it, so the two outputs can be compared before the workflow replaces anything.
The workflow's findings are reported as counts only: they are not applied, not
written to the review ledger, and not posted.

## When

After the Step 4 selection is final and before Step 5 dispatches anything. Run
it once per review.

## Inputs

Write the diff to a fixed file under the git common dir. `>|` overwrites even
under zsh `noclobber`. Use the `DIFF_BASE` value from Step 3a:

```bash
gate_dir="$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/review-gate"
mkdir -p "$gate_dir" || exit 1
git diff "<DIFF_BASE>"...HEAD >| "$gate_dir/pr-<PR#>.diff" || exit 1
printf 'diff_path=%s\n' "$gate_dir/pr-<PR#>.diff"
printf 'base=%s head=%s\n' "$(git merge-base "<DIFF_BASE>" HEAD)" "$(git rev-parse HEAD)"
gh repo view --json nameWithOwner -q .nameWithOwner
```

Read `REVIEW.md` from the default branch, never from the PR head, so a PR cannot
weaken its own review. Step 3a2 already fetched that branch:

```bash
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
case "$DEFAULT_BRANCH" in
  '' | -* | *..* | *[!A-Za-z0-9._/-]*) printf 'review_md=null\n' ;;
  *) git show "origin/$DEFAULT_BRANCH:REVIEW.md" 2>/dev/null || printf 'review_md=null\n' ;;
esac
```

Build `args` as a JSON object, not a JSON-encoded string:

| Key             | Value                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `repo`          | `owner/name` from `gh repo view`                                                                                       |
| `pr`            | the PR number                                                                                                          |
| `base`, `head`  | the merge-base and head SHAs printed above                                                                             |
| `tier`          | the Step 3a2 tier; `high` when it is `unknown`                                                                         |
| `diff_path`     | the absolute path printed above                                                                                        |
| `changed_files` | the PR's changed paths (`git diff --name-only "<DIFF_BASE>"...HEAD`)                                                   |
| `review_md`     | the `REVIEW.md` text, or `null`                                                                                        |
| `include`       | the final Step 4 reviewer set by agent name (`correctness-reviewer`), without `code-simplifier` and the learnings pass |
| `exclude`       | `reviewer_set.exclude`, or `[]`                                                                                        |
| `dismissed`     | `{title, file, line}` for each entry in the Step 3e dismissed-findings block, or `[]`                                  |

## Launch

Call the `Workflow` tool with `name: "yellow-review:review-gate"` and the `args`
above. The run works in the background; continue with Step 5 at once.

If the tool is unavailable, the launch is refused (a `claude -p` run needs a
`Workflow(yellow-review:review-gate)` allow rule) or the run fails, record
`not run (<one-line reason>)` for Step 10 and continue. The shadow run never
blocks or changes the review.

## Compare (before Step 10)

Wait for the run's result. It returns
`{version, tier, findings[], dropped[], coverage{ran, failed, skipped}, agents}`.
Compare it with the findings Step 6 kept (every severity plus Pre-existing): a
workflow finding overlaps when a Step 6 finding has the same `file` and a `line`
within 3. Then add one line to Step 10's Coverage section, counts only:

```
- Workflow shadow (review-gate): <W> findings (<I> Important, <N> Nit, <P> Pre-existing) vs persona <S>; <O> overlap by file+line±3; <D> dropped; <A> agents; failed hunters: <names or none>
```

A non-empty `coverage.failed` means the workflow's review was incomplete, so say
so on the same line. Finally remove the diff file:

```bash
rm -f "$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/review-gate/pr-<PR#>.diff"
```
