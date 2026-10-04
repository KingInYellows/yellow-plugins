---
'yellow-review': minor
---

Harden `/review:resolve` so every unresolved review thread ends in an honest,
durable state. Each thread gets a disposition (`fixed`, `addressed`, `oos`,
`disagree`, `unclear`) that the command validates against the contract in
`references/resolve/dispositions.md` before writing anything; a thread is
normally resolved only after its reply posts (non-actionable threads dropped by
the actionability filter, such as LGTM or a bare nit, are resolved without a
reply), and a `fixed` thread only after a verified push. Out-of-scope threads can file a follow-up issue (capped at 3
per PR when unattended). Replies and issues carry an idempotency marker, so
re-runs dedupe by marker on GitHub (Linear dedupe is best-effort, so a rerun can
still file a second issue if the first was not indexed before its reply failed). The command commits and pushes fixes as a new
commit through the active stacked-PR provider.

The resolver no longer has a Bash tool. Its prompt keeps it to the PR's
changed lines plus at most 3 adjacent lines (the single edit-bounds table is in
`references/resolve/clusters.md`), but that is an instruction, not a sandbox: it
can still write anywhere in a file the PR changes, so the bound is enforced
afterwards. Only files the PR already changes can be committed, and a
`commit-resolve-fixes --check-ranges` pre-check runs before verification and
compares each hunk with the captured ranges (the commit, as hooks left it, is
checked again): unattended runs revert files with edits outside that bound and
leave their threads open as `unclear`; interactive runs ask whether to include
them. The command checks that local HEAD matches the PR head before it starts,
and every stop from the fetch onward prints a final `Resolve:` line.

`resolve-pr-thread` now exits 3 for not-found or permission failures and 4 for
rate limits; `commit-resolve-fixes` uses exits 2 to 6 for refusals and failed
pushes. New scripts under `skills/pr-review-workflow/scripts/`:
`get-pr-blockers`, `reply-pr-thread`, `file-followup-issue` (with a read-only
`--find` mode), `check-resolve-text`, `commit-resolve-fixes`, `run-verify-command`,
`pr-changed-ranges` and `poll-new-threads`. `get-pr-comments` gains an opt-in
`--include-outdated` flag and additive per-thread and per-comment fields
(including `originalLine`, `originalStartLine` and a capped `diffHunk`); its
default filter is unchanged, but a thread list cut short by the page cap or a
missing cursor now exits 3 (partial array on stdout) instead of 0, and a
secondary rate limit reported as HTTP 403 is classified as a rate limit.

Exit codes the resolve scripts share: 6 means the text was refused (a
credential shape, a markdown image, an `@` mention, a URL on another host, or a
scan that did not run), kept apart from usage errors (2); 4 means a rate limit
or timeout. Exit 7, a permanent GitHub refusal, differs by script:
`reply-pr-thread` exits 7 only for HTTP 401 (bad credentials) and exits 3 for
not found or HTTP 403/forbidden; `file-followup-issue` exits 7 for HTTP 401,
HTTP 403 (no issue-write permission) or Issues disabled. Filing exits 3 for a
missing thread; `--find` never looks the thread up and prints
`{"exists":false}` with exit 0 when no marker matches. The
`file-followup-issue` dedupe scan reads every page of the viewer's issues, so the old full-window exit 5 is gone, and
it takes the host from the thread's own pull request URL. `reply-pr-thread`
looks at the newest 10 comments and ignores bot acknowledgements after its
marker; a later comment from the viewer's own human account sends the thread
back through the resolver. `get-pr-blockers` adds `lookupReason` and reads conversation
resolution from the default branch too, so a PR upstack in a stack no longer
reads as not enforced.

Shared libraries: `lib/resolve-text.sh` (`rt_text_clean` for text posted
publicly and `rt_code_clean` for code, diffs and logs, both returning 0 clean,
1 a hit, 2 not scanned; refusals print a `resolve-text: refused rule=...
line=...` line, never the text), `lib/resolve-gh.sh` (`YELLOW_REVIEW_GH_TIMEOUT`
and the shared failure classifiers) and `lib/gh-graphql.sh`, plus
`lib/sibling-plugin.sh` (`sp_sibling_file`), the one sibling-plugin lookup the
ledger and the path rules share.

Behaviour changes for callers: `/review:resolve` now always adds a new
commit instead of amending the previous one, and its last output line is the
`Resolve:` contract line. `/review:resolve-stack` exits 1 whenever anything
blocks (open threads, `CHANGES_REQUESTED`, a rate limit or a dirty-tree
abort), stops and reverts (patch saved) when a PR leaves the tree dirty, and
its summary table now has `blocking` and `issues` columns instead of
`comments found`. For each PR it re-classifies `yellow-plugins.local.md` after
the checkout and, when it is ignored and untracked, snapshots it before the
resolve (`guard-local-config`, authenticated by a digest the walk holds; a
symlinked config is refused), checks it after, and clears the snapshot before
the next PR; it stops the walk, restoring the file, if a PR changed it. `/review:sweep` guards the same config around `/review:pr` and `/review:resolve` too (checked before the resolve runs and again after it, stopping with no contract line if either changed it). `/review:sweep-all` gains a `Blocking` column.
