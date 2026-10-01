---
'yellow-review': minor
---

Harden `/review:resolve` so every unresolved review thread ends in an honest,
durable state. `pr-comment-resolver` now proposes a per-thread disposition
(`fixed`, `addressed`, `oos`, `disagree`, `unclear`) and the command validates
it against the contract in `references/resolve/dispositions.md` before writing
anything: replies and follow-up issues carry an idempotency marker, so re-runs
post no duplicates, and the command commits and pushes fixes as a new commit
through the active stacked-PR provider.

The resolver no longer has a Bash tool; it reads and edits only inside the
PR's changed lines. The command checks that local HEAD matches the PR head
before it starts, and prints a final `Resolve:` line on every stop from the
fetch onward.

`resolve-pr-thread` now exits 3 for not-found or permission failures and 4 for
rate limits; `commit-resolve-fixes` uses exits 2 to 6 for refusals and failed
pushes. New scripts under `skills/pr-review-workflow/scripts/`:
`get-pr-blockers`, `reply-pr-thread`, `file-followup-issue` (with a read-only
`--find` mode), `check-resolve-text`, `commit-resolve-fixes`, `run-verify-command`,
`pr-changed-ranges` and `poll-new-threads`. `get-pr-comments` gains an opt-in
`--include-outdated` flag and additive per-thread and per-comment fields; its
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
looks at the newest 20 comments and ignores bot acknowledgements after its
marker; a later comment from the viewer's own human account sends the thread
back through the resolver. `get-pr-blockers` adds `lookupReason` and reads conversation
resolution from the default branch too, so a PR upstack in a stack no longer
reads as not enforced.

Shared libraries: `lib/resolve-text.sh` (one `rt_text_clean` function; refusals
print a `resolve-text: refused rule=... line=...` line, never the text) and
`lib/resolve-gh.sh` (`YELLOW_REVIEW_GH_TIMEOUT` and the shared failure
classifiers for `reply-pr-thread`, `file-followup-issue` and
`get-pr-blockers`).

The ledger's yellow-core lookup and the path rules' sibling-plugin lookup share
one helper, `lib/sibling-plugin.sh` (`sp_sibling_file`), instead of two copies.
