---
'yellow-core': minor
---

refactor(yellow-core): `best-practices-researcher` inlines `library-context` safe chain

Replaces the Phase 1 "Check Context7 Availability" item in
`plugins/yellow-core/agents/research/best-practices-researcher.md` with
the safe-chain block inlined verbatim from
`yellow-research/skills/library-context/SKILL.md` (cross-plugin `skills:`
preload is unavailable per `anthropics/claude-code#15944`, closed not
planned).

The inlined block uses ONLY built-in tools (context7 + `WebSearch`) — no
yellow-research MCP references — so the agent works for yellow-core
consumers that don't have yellow-research installed. Adds the
drift-detection sentinel `context7 unavailable — falling back to`
(Unicode em dash U+2014) plus two-step invocation, disambiguation,
rate-limit handling, and citation format. The pre-existing Phase 1
items "Query Format" and "Priority Sources" are preserved.
