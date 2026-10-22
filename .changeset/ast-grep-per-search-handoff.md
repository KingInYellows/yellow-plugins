---
'yellow-debt': patch
'yellow-research': patch
---

Replace the global ast-grep recipe lock with a per-search token handoff, so the
complexity and duplication scanners in a parallel `/debt:audit` (and
`code-researcher`) no longer collide or fall back to Grep (CLAUDE-91). Document
the scanners' ast-grep value files in the yellow-debt README (CLAUDE-96).
