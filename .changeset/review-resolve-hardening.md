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
PR's changed lines. The command checks that local HEAD matches the PR head
before it starts, and prints a final `Resolve:` contract line on every stop
from the fetch onward.

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

Shared libraries: `lib/resolve-text.sh` (credential-shape check; refusals print
a `resolve-text: refused rule=... line=...` line, never the text) and
`lib/resolve-gh.sh` (`YELLOW_REVIEW_GH_TIMEOUT` for `file-followup-issue` and
`get-pr-blockers`).

Behaviour changes for callers: `/review:resolve` now always adds a new
commit instead of amending the previous one, and its last output line is the
`Resolve:` contract line. `/review:resolve-stack` exits 1 whenever anything
blocks (open threads, `CHANGES_REQUESTED`, a rate limit or a dirty-tree
abort), stops and reverts (patch saved) when a PR leaves the tree dirty, and
its summary table now has `blocking` and `issues` columns instead of
`comments found`. `/review:sweep-all` gains a `Blocking` column. The
`pr-comment-resolver` agent no longer has a Bash tool.
