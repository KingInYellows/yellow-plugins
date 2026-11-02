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

The workflow's agents read a separate detached checkout of the head commit, not
the working tree: Steps 7 to 9 edit and commit in the working tree while the run
is still going. The checkout and the diff live under the git common dir in a
directory unique to this run, so a second review of the same PR cannot remove
it. `>|` overwrites even under zsh `noclobber`. Use the `DIFF_BASE` value from
Step 3a:

```bash
gate_dir="$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/review-gate" || exit 1
case "$gate_dir" in
  /*) ;;
  *) printf '[review:pr] review-gate: git dir path is not absolute\n' >&2; exit 1 ;;
esac
case "$gate_dir" in
  *[!A-Za-z0-9._/@+-]*) printf '[review:pr] review-gate: git dir path has unsafe characters\n' >&2; exit 1 ;;
esac
mkdir -p "$gate_dir" || exit 1
git worktree prune
gate_root=$(mktemp -d "$gate_dir/pr-<PR#>.XXXXXX") || exit 1
head_sha=$(git rev-parse HEAD) || exit 1
git worktree add --quiet --detach "$gate_root" "$head_sha" || exit 1
git diff "<DIFF_BASE>"...HEAD >| "$gate_root.diff" || exit 1
printf 'repo_root=%s\ndiff_path=%s\n' "$gate_root" "$gate_root.diff"
printf 'base=%s head=%s\n' "$(git merge-base "<DIFF_BASE>" HEAD)" "$head_sha"
gh repo view --json nameWithOwner -q .nameWithOwner
```

If this block fails, run Cleanup below, record `not run (checkout failed)` for
Step 10 and skip the rest of this file. When it stops at the path checks,
nothing was created: skip Cleanup too. Those checks mean the printed `repo_root`
holds only plain path characters, so Cleanup can quote it safely.

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

| Key                | Value                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `repo`             | `owner/name` from `gh repo view`                                                                                            |
| `pr`               | the PR number                                                                                                               |
| `base`, `head`     | the merge-base and head SHAs printed above                                                                                  |
| `tier`             | the Step 3a2 tier; `high` when it is `unknown`                                                                              |
| `diff_path`        | the `diff_path` printed above                                                                                               |
| `repo_root`        | the `repo_root` printed above                                                                                               |
| `changed_files`    | the PR's changed paths, repo-relative (`git diff --name-only "<DIFF_BASE>"...HEAD`)                                         |
| `review_md`        | the `REVIEW.md` text, or `null`                                                                                             |
| `include`          | the final Step 4 reviewer set by bare agent name (`correctness-reviewer`), without `code-simplifier` and the learnings pass |
| `exclude`          | `reviewer_set.exclude`, or `[]`                                                                                             |
| `dismissed`        | one `{file, line, rule, scope}` per `<finding>` in the Step 3e dismissed-findings block (see below), or `[]`                |
| `file_line_counts` | only when `include` has `thermonuclear-reviewer`: see below                                                                 |

The Step 3e block (`review-ledger.sh dismissed-context`) prints each entry as
`<finding><where>FILE:LINE</where><rule>CATEGORY/RULE</rule><scope>…</scope><reason>…</reason></finding>`,
XML-escaped. `<where>` is where the dismissed finding sits at the head commit,
so it still lines up with the hunters' line numbers after lines move above it.
For each entry:

- `file` is the `<where>` text before its last `:`, and `line` the integer after
  it. When that part is not an integer (the ledger prints `null` for a finding
  with no line), pass `line: null`; the workflow skips that entry.
- `rule` is the `<rule>` text as is, for example `correctness/null-handling`.
- `scope` is the `<scope>` text as is: the enclosing function or heading the
  ledger verified, or `unscoped`. A scoped dismissal drops a repeat only within
  that scope, so it does not hide the same rule in the next function down. An
  `unscoped` dismissal matches in any scope, as before.
- Unescape `file`, `rule` and `scope`: `&lt;` to `<`, `&gt;` to `>`, then
  `&amp;` to `&`.
- Leave out `<reason>`: it is free text from the ledger, and the workflow
  matches on file, line within 3, `rule` and `scope`.

When `include` has `thermonuclear-reviewer`, run the Step 5 item 6
`file-line-counts` block now and check its output as item 6 says. Pass the
header line and the rows after it, up to but not including the footer, as the
`file_line_counts` string, without the fence, the tags or any escaping: the
workflow adds those. Leave the key out whenever item 6 would omit the block.
Without it the workflow's thermonuclear hunter reports no size findings.

## Launch

Call the `Workflow` tool with `name: "yellow-review:review-gate"` and the `args`
above. The run works in the background; continue with Step 5 at once.

If the tool is unavailable, the launch is refused (a `claude -p` run needs a
`Workflow(yellow-review:review-gate)` allow rule) or the run fails, run Cleanup,
record `not run (<one-line reason>)` for Step 10 and continue. The shadow run
never blocks or changes the review.

## Compare (before Step 10)

Wait for the run's result, for at most 15 minutes after Step 9 ends. If it has
not finished by then, stop it with `TaskStop`, record `not run (timed out)` for
Step 10 and run Cleanup. The result is
`{version, tier, findings[], dropped[], coverage{ran, failed, skipped, empty}, agents}`.
Compare it with the findings Step 6 kept (every severity plus Pre-existing): a
workflow finding overlaps when a Step 6 finding has the same `file` and a `line`
within 3. Then add one line to Step 10's Coverage section, counts only:

```
- Workflow shadow (review-gate): <W> findings (<I> Important, <N> Nit, <P> Pre-existing) vs persona <S>; <O> overlap by file+line±3; <D> dropped; <A> agents; failed hunters: <names or none>
```

When `coverage.failed` is non-empty or `coverage.empty` is true, the workflow's
review was incomplete: end the line with `(incomplete)`. An empty run is never a
clean one.

## Cleanup

Run this once the workflow result is in, and on every other way the review ends
after the Inputs block ran: the checkout fails, the launch is refused, the run
fails, or the review stops early. Stop a run that is still going first with
`TaskStop` on the task id the `Workflow` call returned, because its agents read
the checkout. Put the `repo_root` printed by the Inputs block inside the single
quotes. The block removes nothing unless that path is a direct child of this
repository's `review-gate` directory made of plain path characters:

```bash
gate_root='<repo_root>'
gate_dir="$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/review-gate" || exit 1
case "$gate_root" in
  *[!A-Za-z0-9._/@+-]* | */../* | */..) printf '[review:pr] review-gate: refusing to clean %s\n' "$gate_root" >&2; exit 1 ;;
  "$gate_dir"/pr-*) ;;
  *) printf '[review:pr] review-gate: refusing to clean %s\n' "$gate_root" >&2; exit 1 ;;
esac
case "${gate_root#"$gate_dir"/}" in
  */*) printf '[review:pr] review-gate: refusing to clean %s\n' "$gate_root" >&2; exit 1 ;;
esac
git worktree remove --force "$gate_root" 2>/dev/null
rm -rf "$gate_root"
rm -f "$gate_root.diff"
git worktree prune
```
