---
"yellow-core": patch
---

`statusline-settings.py statusline` now saves the `.corrupt.backup` of an
invalid, symlinked settings.json next to the link, like the
`.pre-observer.backup`, instead of in the link target's directory. When the
link's directory is not writable, the recovery now fails there as the
pre-observer backup already did. A settings.json symlinked to one of its own
backup names no longer has that file reused as the backup and then
overwritten; the original is copied to the next numbered backup instead.
The context observer docs now match the
code: `--yes` applies only to `observer enable|disable`, and the statusline
script computes its output while the observer records, but Claude Code shows
it only once the whole command exits (recording has a 2 s deadline).
