---
"yellow-core": minor
---

Add 3 focused sub-skills alongside mcp-integration-patterns

Adds three narrower internal skills, each describing one canonical pattern:

- `memory-recall-pattern` — Recall-Before-Act (query ruvector at workflow start)
- `memory-remember-pattern` — Tiered-Remember-After-Act (store at workflow end)
- `morph-discovery-pattern` — Morph edit/warpgrep discovery via ToolSearch

Rationale: more focused skill descriptions let Claude's auto-invocation
routing pick the right pattern instead of loading the umbrella skill when
only one pattern is needed. The three sub-skills are also smaller and
update independently.

The umbrella `mcp-integration-patterns` skill is retained for now; the
prose references in `session-historian.md` and `yellow-core/CLAUDE.md`
still point to it. A follow-up PR will migrate those references to the
appropriate sub-skill and remove the umbrella, once consumers are
validated.
