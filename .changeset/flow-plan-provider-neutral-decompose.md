---
'yellow-core': minor
'yellow-review': patch
---

`/flow:plan` no longer needs Graphite to decompose a plan into stacked PRs. It
asks the stack-provider router which provider is active: Graphite keeps
`gt-workflow:gt-stack-plan`, and every other state uses the new
provider-neutral `stack-decompose` skill, which writes the same
`## Stack Decomposition` section without running any provider command. The
`/flow:work` Phase 4 heading and yellow-review's plugin, `/review:all`,
`/review:resolve-stack` and `stack-traversal` descriptions no longer name
Graphite as the only stack provider.
