---
'yellow-mempalace': patch
'yellow-ruvector': patch
---

Memory-router decision (Tier 2 C11, maintainer-decided): yellow-ruvector is the standard memory system; yellow-mempalace is deprecated pending removal. Generic trigger phrases ("remember this", "record a decision", "add a fact", generic recall) no longer auto-route to mempalace — `memory-archivist`, `/mempalace:search`, `/mempalace:navigate`, `/mempalace:kg`, and `palace-navigator` descriptions are narrowed to explicit `/mempalace:*` / palace / KG invocation, and `/ruvector:learn`'s description reciprocally claims "record a decision" / "save a memory" / "add a fact" so those phrases route somewhere. The full routing table and rationale are recorded in `docs/memory-routing-protocol.md`; mempalace's CLAUDE.md and README carry deprecation banners. Actual plugin removal and palace-data migration are a follow-up plan; explicit mempalace commands keep working until then.
