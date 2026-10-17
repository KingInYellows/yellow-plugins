---
'yellow-codex': minor
---

codex-reviewer findings now carry an `Evidence:` line quoting the cited source
line, so `/council` can verify Codex findings against the file instead of
filing every one under Unverified Claims. The review schema gains a nullable
`evidence` field and the Codex prompt asks for the line verbatim; a missing,
over-long or private-key line is written as `Evidence: N/A — <reason>`.
