---
"yellow-review": patch
---

`run-verify-command --revert-denied` closes five gaps where it reported
`deniedClean: true` while edited trusted config stayed live. An untracked
trusted-config symlink has its target judged before the revert deletes the
link (CLAUDE-101). Below a tracked config directory link, a nested link whose
own mtime is newer than the marker counts (CLAUDE-115), and so does a nested
link that leads back into the worktree, even to an assume-unchanged file
(CLAUDE-94). A nested directory link that leaves the worktree below an alias
into agent memory is walked under the alias's name (CLAUDE-113). An untracked
FIFO, socket or device at a trusted-config path is reported and kept unopened
(CLAUDE-121), including when it is live through a directory symlink; `--dry-run`
lists those nodes in `specialHits` so interactive `/review:resolve` does not
skip them.

The `/review:resolve-stack` and `/review:sweep-all` dirty-tree cleanup now
always runs `--revert-denied` in its unrecognized-paths branch, since a write
through a tracked config link dirties only the link's target (CLAUDE-119).
Both commands create a marker file at pre-flight and the cleanup passes it as
`--ignored-since`, so a gitignored trusted-config edit is caught instead of
left on disk; `--no-ignored-guard` remains only when no marker could be made
(CLAUDE-156).
