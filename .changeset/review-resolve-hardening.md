---
'yellow-review': minor
---

Harden `/review:resolve` so every unresolved review thread ends in an honest,
durable state. `pr-comment-resolver` now proposes a per-thread disposition
(`fixed`, `addressed`, `oos`, `disagree`, `unclear`) and the command validates
it against the contract in `references/resolve/dispositions.md` before writing
anything. `/review:resolve` is wired to that contract and the resolve scripts:
it replies to and resolves threads through `reply-pr-thread` and
`resolve-pr-thread`, files follow-up issues for `oos` threads (GitHub by
default, Linear when available), and leaves `disagree` and `unclear` threads
open as blocking. Replies and follow-up issues carry an idempotency marker, so
re-runs dedupe by marker on GitHub; Linear dedupe is best-effort and a rerun can
still file a second issue if the first was not indexed before its reply failed.
The command commits and pushes fixes as a new commit through the active
stacked-PR provider.

The resolver no longer has a Bash tool; it reads and edits only inside the
PR's changed lines, plus at most 3 adjacent lines. A
`commit-resolve-fixes --check-ranges` pre-check runs before verification:
unattended runs revert files with edits outside that bound and leave their
threads open as `unclear`; interactive runs ask whether to include them. The
command checks that local HEAD matches the PR head
before it starts, and prints a final `Resolve:` contract line on every stop
from the fetch onward.

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
scan that did not run), kept apart from usage errors (2); 7 means a permanent
GitHub refusal (not authenticated, no permission, Issues disabled). A thread
that does not exist exits 3 from `file-followup-issue`. Its dedupe scan reads
every page of the viewer's issues, so the old full-window exit 5 is gone, and
it takes the host from the thread's own pull request URL. `get-pr-blockers`
adds `lookupReason` and reads conversation resolution from the default branch
too, so a PR upstack in a stack no longer reads as not enforced.

Shared libraries: `lib/resolve-text.sh` (`rt_text_clean` for text posted
publicly and `rt_code_clean` for code, diffs and logs, both returning 0 clean,
1 a hit, 2 not scanned; refusals print a `resolve-text: refused rule=...
line=...` line, never the text), `lib/resolve-gh.sh` (`YELLOW_REVIEW_GH_TIMEOUT`
and the shared failure classifiers) and `lib/gh-graphql.sh`, plus
`lib/sibling-plugin.sh` (`sp_sibling_file`), the one sibling-plugin lookup the
ledger and the path rules share.
