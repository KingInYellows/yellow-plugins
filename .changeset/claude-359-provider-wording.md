---
'yellow-linear': patch
'yellow-review': patch
---

`/linear:setup` judges the stack tool against the active stacked-PR provider:
`gt` only for Graphite, the `gh-stack` extension for GitHub, and it points to
`/stack:status` when the provider is unresolved. The README no longer lists `gt`
as a general prerequisite. yellow-review's CLAUDE.md now says
`commit-resolve-fixes` submits through its provider and verifies the remote
head, so callers add no `git push` after it (CLAUDE-359).
