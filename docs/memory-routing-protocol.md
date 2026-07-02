# Memory Routing Protocol

Which memory system fires for which trigger phrase. Sibling of
`docs/plugin-credential-status-protocol.md` and
`docs/plugin-scope-mode-protocol.md`. This records a maintainer decision
(2026-07-01, Tier 2 C11 decision gate) — it was deliberately NOT decided
by the implementer.

## Decision

**yellow-ruvector is the single, standard memory system.** Generic
memory trigger phrases — "remember this", "record this
mistake/decision", "save this pattern", "what do we know about X", "what
did we learn about X" — route to yellow-ruvector surfaces
(`/ruvector:learn`, `/ruvector:memory`, `ruvector-memory-manager`).

**yellow-mempalace is deprecated pending removal.** Its trigger phrases
are narrowed so nothing auto-routes to it: mempalace surfaces respond
only to explicit invocation (`/mempalace:*` commands, or the user naming
the palace / knowledge graph). Actual plugin removal and palace-data
migration are a follow-up plan, NOT part of the change that introduced
this document — until that lands, mempalace remains installable and its
explicit commands keep working.

Rationale (from the decision discussion): the two systems are redundant
for the core capture/recall loop, and the repo's infrastructure has
already standardized on ruvector — ~10 command surfaces consume its
recall/remember protocol (drift-linted as of RULE 16), hooks capture
automatically, and nothing consumes mempalace content. mempalace's
unique value (knowledge-graph triples, spatial taxonomy) is unused by
any workflow.

## Trigger routing table

| Trigger phrase | Routes to | Notes |
|----------------|-----------|-------|
| "remember this", "save this pattern", "record this mistake", "don't forget X" | `/ruvector:learn` (user-invoked) / `ruvector-memory-manager` (agent-invoked) | The command is the user surface; the agent serves other agents' memory needs |
| "record a decision", "add a fact", "save a memory" | yellow-ruvector (same surfaces as above) | Previously also claimed by mempalace's `memory-archivist` — narrowed by this decision |
| "what do we know about X", "show memories", "list learnings" | `/ruvector:memory` | Cross-reference with `/mempalace:search` shipped in Tier 1 C2; superseded by this decision (ruvector is now the default for generic recall) |
| "browse the palace", "show wings", `/mempalace:*` | yellow-mempalace | Explicit invocation only — deprecated pending removal |
| MEMORY.md auto-memory pipeline | `staging-promoter` (background compounding) | Trigger-free; not part of this routing decision |

## Domain model

Disjoint with a single primary: memories land in ruvector. No dual-write.
Palace data existing today stays readable via explicit `/mempalace:*`
commands until the removal plan handles migration/export.

## Follow-up (out of scope here)

A separate plan item covers: deprecation notice in the marketplace
listing, palace-data export path, removal from
`.claude-plugin/marketplace.json` + `plugins/yellow-core/commands/setup/all.md`
(both must change together — `validate-setup-all.js`), and deletion of
`plugins/yellow-mempalace/`.
