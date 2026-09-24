---
'gt-workflow': patch
'yellow-core': patch
---

docs: correct stale stack-registry comments — `stack-operation-registry.js`,
yellow-core `CLAUDE.md` and gt-workflow `CLAUDE.md` no longer claim a
`/stack:<name>` command per neutral operation (only `/stack:status` and
`/stack:select` exist; `/flow:work` is the registry's consumer).
