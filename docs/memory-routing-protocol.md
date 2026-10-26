# Memory Routing Protocol

Which memory system fires for which trigger phrase. Sibling of
`docs/plugin-credential-status-protocol.md` and
`docs/plugin-scope-mode-protocol.md`. This records a maintainer decision
(2026-07-01, Tier 2 C11 decision gate) — it was deliberately NOT decided by the
implementer.

## Decision

**yellow-ruvector is the single, standard memory system.** Generic memory
trigger phrases — "remember this", "record this mistake/decision", "save this
pattern", "what do we know about X", "what did we learn about X" — route to
yellow-ruvector surfaces (`/ruvector:learn`, `/ruvector:memory`,
`ruvector-memory-manager`).

**yellow-mempalace has been removed.** The decision first deprecated it and
narrowed its trigger phrases to explicit invocation; the follow-up removal plan
then deleted the plugin (see "Follow-up (done)" below). No memory trigger routes
anywhere other than yellow-ruvector.

Rationale (from the decision discussion): the two systems are redundant for the
core capture/recall loop, and the repo's infrastructure has already standardized
on ruvector — ~10 command surfaces consume its recall/remember protocol (RULE 16
drift-lints the protocol's canonical SKILL.md copies in CI; the consuming
command files only paraphrase those constants in prose and aren't covered by
that automated check — they get occasional manual-sweep review instead), hooks
capture automatically, and nothing consumes mempalace content. mempalace's
unique value (knowledge-graph triples, spatial taxonomy) is unused by any
workflow.

## Trigger routing table

| Trigger phrase                                                                | Routes to                                                                    | Notes                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| "remember this", "save this pattern", "record this mistake", "don't forget X" | `/ruvector:learn` (user-invoked) / `ruvector-memory-manager` (agent-invoked) | The command is the user surface; the agent serves other agents' memory needs                                            |
| "record a decision", "add a fact", "save a memory"                            | yellow-ruvector (same surfaces as above)                                     | Formerly claimed by mempalace's `memory-archivist`; `/ruvector:learn`'s description now claims these phrases explicitly |
| "what do we know about X", "show memories", "list learnings"                  | `/ruvector:memory`                                                           | The old cross-reference to mempalace search was removed with the plugin                                                 |
| MEMORY.md auto-memory pipeline                                                | `staging-promoter` (background compounding)                                  | Trigger-free; not part of this routing decision                                                                         |

## Domain model

Generic memory triggers land in ruvector only. Separately, the trigger-free
MEMORY.md pipeline writes `docs/solutions/` and `MEMORY.md`, and
`/flow:compound` can also record the same learning with `hooks_remember`.

## Follow-up (done)

The removal plan referenced above has landed: `plugins/yellow-mempalace/` is
deleted, its catalog source and marketplace listing are gone, `setup/all.md` no
longer references it, and the `/ruvector:memory` cross-reference to
`/mempalace:search` was removed. The rationale above is kept as the historical
record of the decision.
