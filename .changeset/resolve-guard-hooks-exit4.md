---
'yellow-review': patch
---

`run-verify-command`'s ignored-file guard now also refuses when a hook in
`.git/hooks` (or a hooks directory outside the tree) changed after the
`--ignored-since` marker, using the same wording so `/review:resolve` takes its
ignored-file stop (CLAUDE-60). It also refuses when a config file Git reads, or
a symlink on the way to a hook or config file, changed after the marker, and a
new `--mark-hooks` mode, run by `/review:resolve` when it mints the marker,
records the effective hooks directory so a change to it is refused too.
`guard-local-config check` ends every exit 4 with its own `snapshot kept at`
line: only a failed restore points at the snapshot as the copy to recover from,
while an invalid or tampered snapshot is kept for investigation only;
`/review:sweep` and `/review:resolve-stack` print that line instead of one fixed
recovery hint (CLAUDE-69). The dirty-tree cleanup notes now state why no
per-path baseline is recorded (CLAUDE-67).
