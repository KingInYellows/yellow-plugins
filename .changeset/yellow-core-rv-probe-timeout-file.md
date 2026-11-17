---
'yellow-core': patch
---

`/setup:all`'s ruvector probe now writes the CLI's `--version` output to a temp
file on the timeout path too. On systems whose `timeout` kills only its direct
child (uutils coreutils, the default on Ubuntu 26.04), a leftover child of a CLI
that ignores TERM held the probe's pipe open and stalled the dashboard for as
long as that child lived (CLAUDE-346).

The compound-staging Stop capture and the Jev pre-filter now take their byte
cap with a shell substring instead of `tail -c` on a pipe, and the 8 KiB cap
check reads the file directly. On a pipe uutils `tail -c N` can return more than
N bytes, so a large transcript tail could be staged over the 96 KiB cap.
