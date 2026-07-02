---
'yellow-mempalace': patch
---

Memory-router decision (Tier 2 C11, maintainer-decided): yellow-ruvector is the standard memory system; yellow-mempalace is deprecated pending removal. Generic trigger phrases ("remember this", "record a decision", "add a fact", generic recall) no longer auto-route to mempalace — `memory-archivist` and `/mempalace:search` descriptions are narrowed to explicit `/mempalace:*` invocation, with the full routing table and rationale recorded in `docs/memory-routing-protocol.md`. Actual plugin removal and palace-data migration are a follow-up plan; explicit mempalace commands keep working until then.
