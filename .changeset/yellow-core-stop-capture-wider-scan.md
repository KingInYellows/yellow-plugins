---
'yellow-core': patch
---

The Stop hook capture no longer stages an empty transcript tail when the last
1000 transcript lines are mostly non-dialogue records (attachments, progress,
queue operations). The scan window now doubles until it holds 100 dialogue
records, passes the 96 KiB byte cap, covers the whole file, or reaches 128000
lines. Empty tails from different sessions shared one content hash, so drain
dedup could drop all but one of them (CLAUDE-148).
