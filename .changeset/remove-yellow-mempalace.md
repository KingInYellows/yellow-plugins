---
'yellow-core': patch
'yellow-ruvector': patch
---

Remove the `yellow-mempalace` plugin. It was deprecated in favor of
`yellow-ruvector` as the single standard memory system (see
`docs/memory-routing-protocol.md`); this completes that follow-up by
deleting `plugins/yellow-mempalace/`, its catalog source, and its
marketplace/setup-all references, and drops the now-dead
`/mempalace:search` cross-reference from `/ruvector:memory`'s description.
