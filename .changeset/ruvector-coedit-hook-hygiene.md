---
'yellow-ruvector': minor
---

Stop writing memories from hooks and record co-edits instead. The PostToolUse
hook no longer calls ruvector's `hooks post-edit` / `hooks post-command`: each
call stored a near-empty hash-embedded memory ("successful edit of ts in
project", "npm test succeeded"), which cluttered recall, was refused on
ONNX-stamped stores, and on a fresh store was the write that stamped it hash/64d
so every later `hooks_remember` was refused (ADR-210). Their co-edit tracking
never recorded anything (ruvector keeps `lastEditedFile` per process). The hook
now records "files edited together" pairs in a plugin-owned
`.ruvector/coedit.json` with jq only (no Node start; ~3x faster), using
per-session state so concurrent sessions and worktrees never pair each other's
edits, atomic writes under bounded locks, and a cap of 1000 file pairs (2000
directed entries, and under 1 MB). MultiEdit
is read from its top-level `tool_input.file_path` (the old `edits[].file_path`
never matched). The Stop hook (`hooks session-end`, which rewrote the whole
store every turn) and the PostToolUseFailure registration are removed; no plugin
hook writes `intelligence.json` any more.
