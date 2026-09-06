---
'yellow-core': minor
---

Add a `PreCompact` hook. `hooks/scripts/pre-compact.sh` prints the Claude
5-generation compaction-preservation instruction (active plan path and
unchecked tasks, files modified with reasons, the user's decisions and
constraints verbatim, open questions, the last failing command, in-flight
branch/PR/worktree names); Claude Code appends it to the main-session
compaction prompt (subagent compactons discard hook stdout).
Synchronous, dependency-free, always exits 0 so it can never block compaction.
