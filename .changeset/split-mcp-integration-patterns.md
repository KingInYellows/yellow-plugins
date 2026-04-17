---
"yellow-core": minor
---

Split mcp-integration-patterns into 3 focused sub-skills

Replaces the 263-line `mcp-integration-patterns` skill with three narrower
internal skills, each describing one canonical pattern:

- `memory-recall-pattern` — Recall-Before-Act (query ruvector at workflow start)
- `memory-remember-pattern` — Tiered-Remember-After-Act (store at workflow end)
- `morph-discovery-pattern` — Morph edit/warpgrep discovery via ToolSearch

Rationale: more focused skill descriptions let Claude's auto-invocation
routing pick the right pattern instead of loading the umbrella skill when
only one pattern is needed. The three sub-skills are also smaller and
update independently.

No command or agent referenced the old skill via `skills:` frontmatter, so
no consumer migrations are required. Brainstorm docs retain historical
references to the old skill name (these are preserved as time-stamped
artifacts, not references).

`plugins/yellow-core/CLAUDE.md` updated to list the three new skills and
point MCP Tool Integration notes to the appropriate sub-skill.
