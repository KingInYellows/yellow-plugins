---
"yellow-core": patch
"yellow-review": patch
---

A-01 (audit 2026-05-07): pin `model: opus` on five deep-analysis review
personas that previously inherited the parent's model. Establishes
deterministic quality on the most analytically demanding agents in the
review surface, completing the existing pinning convention
(`architecture-strategist`, `research-conductor` are already pinned to
opus).

**yellow-core:**
- `agents/review/security-sentinel.md`: `model: inherit` → `model: opus`
- `agents/review/performance-oracle.md`: `model: inherit` → `model: opus`

**yellow-review:**
- `agents/review/adversarial-reviewer.md`: `model: inherit` → `model: opus`
- `agents/review/agent-cli-readiness-reviewer.md`: `model: inherit` → `model: opus`
- `agents/review/agent-native-reviewer.md`: `model: inherit` → `model: opus`

Identifier `opus` (bare string) matches existing precedent in
`plugins/yellow-core/agents/review/architecture-strategist.md`.

**A-02 Phase 1 (audit pass):** the brainstorm proposed restricting
`tools:` on eight read-only research agents but per-body verification
(deepen-plan codebase research) shows all 8 already have correct narrowed
scope — no edits needed:

| Agent | Status |
|---|---|
| `learnings-researcher` | already `[Read, Grep, Glob]` |
| `repo-research-analyst` | `[Read, Grep, Glob, Bash]` — Bash needed |
| `best-practices-researcher` | `[WebSearch, WebFetch, Read, Glob, Grep]` — keep |
| `git-history-analyzer` | `[Bash, Read, Grep, Glob]` — Bash needed |
| `spec-flow-analyzer` | `[Read, Grep, Glob, Bash]` — Bash needed |
| `code-researcher` | broad toolset by design (Read, Grep, Glob, Bash, ToolSearch + 11 MCP tools) — keep; restricting would break inline research |
| `codex-analyst` | `[Bash, Read, Grep, Glob]` — Bash needed |
| `linear-explorer` | `[Bash, ToolSearch, 5× MCP]` — verified |

Audit confirms least-privilege precedent is already in place for these
eight agents. No `Edit`/`Write` inheritance found.
