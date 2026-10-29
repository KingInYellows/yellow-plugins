---
'yellow-core': patch
---

Stop capture keeps only user and assistant records, so text lines no longer take
dialogue slots and a half-written final line is dropped. A tail with no dialogue
is not staged, and an older capture of a session that finishes after a newer one
no longer replaces or re-stages its entry (CLAUDE-199).
