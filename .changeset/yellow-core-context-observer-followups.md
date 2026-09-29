---
"yellow-core": patch
---

`statusline-settings.py statusline` now saves the `.corrupt.backup` of an
invalid, symlinked settings.json next to the link, like the
`.pre-observer.backup`, instead of in the link target's directory. When the
link's directory is not writable, the recovery now fails there as the
pre-observer backup already did. The context observer docs now match the
code: `--yes` applies only to `observer enable|disable`, and the statusline
script computes its output while the observer records, but Claude Code shows
it only once the whole command exits (recording is capped at 2 s). New bats
cases cover `settings_unreadable`, `io_error`, a future-dated record and the
`REWRITE_AFTER_SECONDS` < `CO_STALE_AFTER` invariant.
