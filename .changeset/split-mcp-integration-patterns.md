---
"yellow-core": minor
---

Split mcp-integration-patterns into 3 focused sub-skills

Replaces the 262-line `mcp-integration-patterns` skill with three narrower
internal skills, each describing one canonical pattern:

- `memory-recall-pattern` — Recall-Before-Act (query ruvector at workflow start)
- `memory-remember-pattern` — Tiered-Remember-After-Act (store at workflow end)
- `morph-discovery-pattern` — Morph edit/warpgrep discovery via ToolSearch

Rationale: more focused skill descriptions let Claude's auto-invocation
routing pick the right pattern instead of loading the umbrella skill when
only one pattern is needed. The three sub-skills are also smaller and
update independently.

No command or agent referenced the old skill via `skills:` frontmatter, so
no consumer migrations are required. Brainstorm docs and the
`plans/session-level-review.md` plan retain references to the old skill
name; the live actionable TODO at `plans/session-level-review.md:276` has
been updated to reference the two replacement skills, while archived
brainstorm references are left as historical artifacts.

`plugins/yellow-core/CLAUDE.md` updated to list the three new skills (plus
`security-fencing`, added in the companion extract-security-fencing-skill
changeset on this branch) and point MCP Tool Integration notes to the
appropriate sub-skill.
