---
'yellow-review': minor
---

Add the building blocks for hardening `/review:resolve` so every unresolved
review thread can end in an honest, durable state, and the dispositions
contract they implement (`references/resolve/dispositions.md`). A thread gets a
disposition (`fixed`, `addressed`, `oos`, `disagree`, `unclear`); replies and
follow-up issues carry an idempotency marker, so re-runs post no duplicates.
`/review:resolve` and `pr-comment-resolver` are not wired to the contract yet;
their behavior is unchanged until a later PR of this stack.

New scripts under `skills/pr-review-workflow/scripts/`: `get-pr-blockers`,
`reply-pr-thread`, `file-followup-issue` (with a read-only `--find` mode) and
`check-resolve-text`. `get-pr-comments` gains an opt-in `--include-outdated`
flag and additive per-thread and per-comment fields (including
`originalLine`, `originalStartLine` and, for outdated threads, `diffHunk`);
its default filter is unchanged, but a thread list cut short by the page cap
or a missing cursor now exits 3 (partial array on stdout) instead of 0, and a
secondary rate limit reported as HTTP 403 is classified as a rate limit.

Exit codes the resolve scripts share: 6 means the text was refused (a
credential shape, a markdown image, an `@` mention, a URL on another host, or a
scan that did not run), kept apart from usage errors (2); 7 means a permanent
GitHub refusal (not authenticated, no permission, Issues disabled). A thread
that does not exist exits 3 from `file-followup-issue`. Its dedupe scan reads
every page of the viewer's issues, so the old full-window exit 5 is gone, and
it takes the host from the thread's own pull request URL. `reply-pr-thread`
looks at the newest 20 comments and ignores bot acknowledgements after its
marker. `get-pr-blockers` adds `lookupReason` and reads conversation
resolution from the default branch too, so a PR upstack in a stack no longer
reads as not enforced.

Shared libraries: `lib/resolve-text.sh` (one `rt_text_clean` function; refusals
print a `resolve-text: refused rule=... line=...` line, never the text) and
`lib/resolve-gh.sh` (`YELLOW_REVIEW_GH_TIMEOUT` and the shared failure
classifiers for `reply-pr-thread`, `file-followup-issue` and
`get-pr-blockers`).
