---
'yellow-core': patch
---

`/setup:all`'s ruvector probe now writes the CLI's `--version` output to a temp
file on the timeout path too. On systems whose `timeout` kills only its direct
child (uutils coreutils, the default on Ubuntu 26.04), a leftover child of a CLI
that ignores TERM held the probe's pipe open and stalled the dashboard for as
long as that child lived (CLAUDE-346).
