---
title: "feat: Add yellow-research plugin"
type: feat
date: 2026-02-21
brainstorm: docs/brainstorms/2026-02-21-yellow-research-plugin-brainstorm.md
deepened: 2026-02-21
---

# feat: Add yellow-research Plugin

## Enhancement Summary

**Deepened on:** 2026-02-21
**Research sources:** MCP integration skill, EXA/Tavily/Parallel GitHub READMEs,
institutional learnings, architecture and security reviews.

### Key Improvements from Deepening

1. **Exact tool names confirmed** for all 4 MCPs — no guessing required
2. **Parallel Task auth resolved** — HTTP `headers` field natively supports Bearer token
3. **`allowed-tools` updated** from wildcards to explicit tool names per security best practice
4. **Slug confirmation removed** — auto-name simplifies UX, user renames if needed
5. **EXA `get_code_context_exa` identified** as the key tool for code research
6. **MCP tool name empirical verification step** added — prevents ruvector-class bug

---

## Overview

Add `yellow-research` — a personal deep-research plugin for Claude Code that
bundles Perplexity, Tavily, EXA, and Parallel Task MCP servers and exposes two
distinct workflows:

- **`/research:code`** — Inline, fast code research for active development
- **`/research:deep`** — Multi-source deep research saved to `docs/research/`

A `research-conductor` agent handles intelligent routing inside the deep
research workflow, using Claude's native `Task` tool for session-level parallel
fan-out and the Parallel Task MCP for long-horizon async research tasks.

---

## Research Findings

### Confirmed MCP Package Names

| Server | Package / URL | Transport | API Key Env Var | Status |
|--------|---------------|-----------|-----------------|--------|
| Perplexity | `@perplexity-ai/mcp-server` | stdio | `PERPLEXITY_API_KEY` | Already installed as own plugin |
| Tavily | `tavily-mcp` | stdio | `TAVILY_API_KEY` | Available via deferred tools |
| EXA | `exa-mcp-server` | stdio | `EXA_API_KEY` | **Not yet in any plugin** |
| Parallel Task | `https://task-mcp.parallel.ai/mcp` | HTTP | `PARALLEL_API_KEY` | New — from parallel.ai |

### Confirmed MCP Tool Names

**CRITICAL:** Always use exact tool names in `allowed-tools`. Wildcards are a
security anti-pattern. Tool names verified against live packages and docs.

#### EXA (`mcp__plugin_yellow-research_exa__*`)

| Tool Name | On by Default | Use Case |
|-----------|---------------|----------|
| `web_search_exa` | ✅ | General web search |
| `get_code_context_exa` | ✅ | Code examples, docs, GitHub, Stack Overflow |
| `company_research_exa` | ✅ | Company/org research |
| `web_search_advanced_exa` | ❌ | Full-control search with date/domain filters |
| `crawling_exa` | ❌ | Full content of specific URL |
| `deep_researcher_start` | ❌ | Start async EXA deep research report |
| `deep_researcher_check` | ❌ | Check EXA async research status |

> `get_code_context_exa` is the primary tool for `/research:code`. Enable
> `crawling_exa` by adding `?tools=all` to the Smithery endpoint if needed.

#### Tavily (`mcp__plugin_yellow-research_tavily__*`)

Actual tool names (from live session deferred tools): `tavily_search`,
`tavily_extract`, `tavily_crawl`, `tavily_map`, `tavily_research`

> Note: GitHub README shows `tavily-search` (hyphen) but actual MCP tool names
> use underscores. The deferred tools in this session confirm underscore format.

#### Parallel Task (`mcp__plugin_yellow-research_parallel__*`)

| Tool Name | Use Case |
|-----------|----------|
| `create_deep_research_task` | Launch async research; returns task ID |
| `create_task_group` | Parallel enrichment for multiple items |
| `get_result` | Retrieve completed research results |

#### Perplexity (`mcp__plugin_yellow-research_perplexity__*`)

From live session: `perplexity_ask`, `perplexity_research`, `perplexity_search`,
`perplexity_reason`

### Key Architecture Clarifications

- **Parallel Task MCP auth** — HTTP type supports `headers` field natively.
  Use `"headers": {"Authorization": "Bearer ${PARALLEL_API_KEY}"}`. No
  `mcp-remote` proxy needed.
- **Perplexity** re-declared in this plugin's `mcpServers` for standalone
  install capability (safe — Claude Code deduplicates by server name).
- **Context7** available via `compound-engineering` — `code-researcher` calls
  it natively via `mcp__plugin_compound-engineering_context7__*`.
- **EXA `get_code_context_exa`** is the code-specific search tool — superior
  to generic `web_search_exa` for code research use case.
- **MCP tool name discovery** — After install, run `ToolSearch "exa"` etc. to
  see actual registered names. Never trust LLM training data for names.

---

## File Structure

```
plugins/yellow-research/
  .claude-plugin/
    plugin.json                      # Manifest: mcpServers + components list
  agents/
    research/
      research-conductor.md          # Routes /research:deep queries; decides fan-out
      code-researcher.md             # Inline code research for /research:code
  commands/
    research/
      code.md                        # /research:code
      deep.md                        # /research:deep
  skills/
    research-patterns/
      SKILL.md                       # Conventions: slug naming, output format, API key setup
  CLAUDE.md                          # Plugin context for Claude
  README.md                          # Human-facing docs
```

Plus one update:

```
.claude-plugin/marketplace.json      # Add yellow-research entry
```

---

## Technical Approach

### Phase 1: Plugin Manifest

**File: `plugins/yellow-research/.claude-plugin/plugin.json`**

```json
{
  "name": "yellow-research",
  "version": "1.0.0",
  "description": "Deep research plugin with Perplexity, Tavily, EXA, and Parallel Task MCP servers. Code research inline; deep research saved to docs/research/.",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/KingInYellows"
  },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-research",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["research", "deep-research", "perplexity", "exa", "tavily", "mcp"],
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}",
        "PERPLEXITY_TIMEOUT_MS": "${PERPLEXITY_TIMEOUT_MS:-600000}"
      }
    },
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp"],
      "env": {
        "TAVILY_API_KEY": "${TAVILY_API_KEY}"
      }
    },
    "exa": {
      "command": "npx",
      "args": ["-y", "exa-mcp-server"],
      "env": {
        "EXA_API_KEY": "${EXA_API_KEY}"
      }
    },
    "parallel": {
      "type": "http",
      "url": "https://task-mcp.parallel.ai/mcp",
      "headers": {
        "Authorization": "Bearer ${PARALLEL_API_KEY}"
      }
    }
  }
}
```

**Notes:**
- `repository` is a plain string URL (not an object) — required by Claude Code validator
- `hooks` field omitted entirely — no hooks in this plugin
- `parallel` uses native HTTP `headers` for Bearer auth — no `mcp-remote` needed
- After install, verify tool names with `/mcp` command before using in agents

### Phase 2: Commands

#### `/research:code` — `commands/research/code.md`

```markdown
---
name: research:code
description: Inline code research for active development. Use when user asks how a library works, needs code examples, API patterns, or framework documentation. Fast and in-context — no file saved.
argument-hint: '<topic or question>'
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - ToolSearch
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__get_code_context_exa
  - mcp__plugin_compound-engineering_context7__resolve-library-id
  - mcp__plugin_compound-engineering_context7__query-docs
  - mcp__grep__searchGitHub
  - mcp__plugin_yellow-research_perplexity__perplexity_search
---
```

Body:
1. Parse `$ARGUMENTS` — if empty, surface error (argument is required for code research)
2. Delegate to `code-researcher` agent with the topic
3. Return synthesized inline answer — no file written

**No Task tool** — code research should be fast and in-process. The agent
handles routing to the right source.

#### `/research:deep` — `commands/research/deep.md`

```markdown
---
name: research:deep
description: Multi-source deep research saved to docs/research/. Use when user needs a comprehensive report on a topic, competitive analysis, technical landscape, or architectural decision support.
argument-hint: '<topic>'
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__web_search_advanced_exa
  - mcp__plugin_yellow-research_exa__crawling_exa
  - mcp__plugin_yellow-research_exa__deep_researcher_start
  - mcp__plugin_yellow-research_exa__deep_researcher_check
  - mcp__plugin_yellow-research_tavily__tavily_search
  - mcp__plugin_yellow-research_tavily__tavily_extract
  - mcp__plugin_yellow-research_tavily__tavily_research
  - mcp__plugin_yellow-research_tavily__tavily_crawl
  - mcp__plugin_yellow-research_parallel__create_deep_research_task
  - mcp__plugin_yellow-research_parallel__create_task_group
  - mcp__plugin_yellow-research_parallel__get_result
  - mcp__plugin_yellow-research_perplexity__perplexity_ask
  - mcp__plugin_yellow-research_perplexity__perplexity_research
  - mcp__plugin_yellow-research_perplexity__perplexity_reason
  - mcp__grep__searchGitHub
---
```

Body:
1. Parse topic from `$ARGUMENTS` (or AskUserQuestion if empty)
2. Generate slug: kebab-case from topic, max 40 chars, `[a-z0-9-]` only
3. Check if `docs/research/<slug>.md` exists — if so, append `-2`, `-3` suffix
4. Create `docs/research/` if missing (`mkdir -p`)
5. Delegate to `research-conductor` agent with topic + target path
6. Write conductor output to `docs/research/<slug>.md`
7. Report: file path created. Suggest `/compound` if findings are major.

**No slug confirmation dialog** — auto-name and write. User can rename after if
needed. Keeping UX simple for a personal plugin.

### Phase 3: Agents

#### `research-conductor.md` — `agents/research/research-conductor.md`

```yaml
---
name: research-conductor
description: Routes deep research queries across multiple sources. Use when /research:deep needs multi-source investigation. Triages complexity and dispatches fan-out: simple queries go to Perplexity alone; moderate to 2-3 parallel sources; complex to full fan-out including Parallel Task MCP for async reports.
model: inherit
allowed-tools:
  - Task
  - ToolSearch
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__web_search_advanced_exa
  - mcp__plugin_yellow-research_exa__deep_researcher_start
  - mcp__plugin_yellow-research_exa__deep_researcher_check
  - mcp__plugin_yellow-research_tavily__tavily_search
  - mcp__plugin_yellow-research_tavily__tavily_research
  - mcp__plugin_yellow-research_tavily__tavily_crawl
  - mcp__plugin_yellow-research_parallel__create_deep_research_task
  - mcp__plugin_yellow-research_parallel__get_result
  - mcp__plugin_yellow-research_perplexity__perplexity_ask
  - mcp__plugin_yellow-research_perplexity__perplexity_research
  - mcp__plugin_yellow-research_perplexity__perplexity_reason
  - mcp__grep__searchGitHub
---
```

System prompt (≤100 lines):

**Step 1: Triage**
- **Simple** (1 aspect, well-defined): Single Perplexity `perplexity_reason` call
- **Moderate** (2-3 aspects, moderate depth): 2-3 parallel Task tool calls to
  complementary sources (e.g., Perplexity for web + EXA for technical content)
- **Complex** (broad topic, multiple angles, report-grade): Full fan-out:
  `perplexity_research` + `tavily_research` + `deep_researcher_start` (EXA
  async) + `create_deep_research_task` (Parallel) in parallel; poll EXA/Parallel
  results with their check/get tools

**Step 2: Execute**
- Use Task tool to dispatch concurrent queries for moderate/complex
- For async tools (`deep_researcher_start`, `create_deep_research_task`): start
  them first, do synchronous queries while they run, then poll for results

**Step 3: Converge**
Synthesize all results into structured markdown:
```markdown
# <Topic>
## Summary
## Key Findings
### <Subtopic 1>
### <Subtopic 2>
## Sources
```

Keep under 100 lines. No examples or training data.

#### `code-researcher.md` — `agents/research/code-researcher.md`

```yaml
---
name: code-researcher
description: Inline code research for active development. Use when user asks how to use a library, needs code patterns, API docs, or real-world examples. Routes to best source by query type; returns concise synthesis in-context.
model: inherit
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - ToolSearch
  - mcp__plugin_yellow-research_exa__get_code_context_exa
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_compound-engineering_context7__resolve-library-id
  - mcp__plugin_compound-engineering_context7__query-docs
  - mcp__grep__searchGitHub
  - mcp__plugin_yellow-research_perplexity__perplexity_search
---
```

System prompt (≤80 lines):

**Source routing by query type:**
- Library/framework docs → Context7 first (`resolve-library-id` → `query-docs`)
- Real-world code examples / patterns → `get_code_context_exa` (GitHub, Stack
  Overflow, docs)
- GitHub code search → `mcp__grep__searchGitHub`
- Bleeding-edge / news → `perplexity_search`

**Output:** Max 2-3 paragraphs inline. Code snippets when relevant. If findings
are substantial enough to save, suggest `/research:deep` instead.

Keep under 80 lines.

### Phase 4: Skill

#### `research-patterns.md` — `skills/research-patterns.md`

```yaml
---
name: research-patterns
user-invokable: false
description: Conventions and reference patterns for yellow-research plugin — slug naming, output format, API key setup, source selection guide, graceful degradation.
---
```

Content sections:
- **Slug naming:** `[a-z0-9-]` only, max 40 chars, auto-generated from topic
  (e.g., "React Server Components 2026" → `react-server-components-2026`)
- **Output location:** `docs/research/<slug>.md`
- **When to compound:** Major technical decisions, novel architectural patterns,
  reusable institutional knowledge → run `/compound` after deep research
- **API key setup:** Export in `~/.zshrc`:
  ```sh
  export EXA_API_KEY="..."
  export TAVILY_API_KEY="..."
  export PERPLEXITY_API_KEY="..."
  export PARALLEL_API_KEY="..."
  ```
- **Graceful degradation:** If a source MCP is unavailable, skip it and
  continue. Conductor should always return something even with 1 source.
- **Source selection guide:**
  - Perplexity → web-grounded synthesis, recent news, reasoning
  - EXA `get_code_context_exa` → code examples, docs, GitHub
  - Tavily → fast web search, page extraction/crawl
  - Parallel Task → long async reports (>2min research)
- **Tool name verification:** After new installs, use `ToolSearch "<server>"`
  to verify actual MCP tool names before writing agent code

### Phase 5: CLAUDE.md

```markdown
# yellow-research Plugin

Deep research plugin with 4 MCP servers. Two workflows: code research (inline)
and deep research (saved to docs/research/).

## MCP Servers

- **perplexity** — `perplexity_ask`, `perplexity_research`, `perplexity_search`,
  `perplexity_reason` — Env: `PERPLEXITY_API_KEY`
- **tavily** — `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map`,
  `tavily_research` — Env: `TAVILY_API_KEY`
- **exa** — `web_search_exa`, `get_code_context_exa`, `web_search_advanced_exa`,
  `crawling_exa`, `deep_researcher_start`, `deep_researcher_check` — Env: `EXA_API_KEY`
- **parallel** — `create_deep_research_task`, `create_task_group`, `get_result`
  — Env: `PARALLEL_API_KEY` (HTTP Bearer auth)

Tool name prefix: `mcp__plugin_yellow-research_<server>__<tool>`

## Conventions

- Slug format: `[a-z0-9-]`, max 40 chars, auto-generated from topic
- Output: `docs/research/<slug>.md`
- Code research: always inline, never saves
- Deep research: always saves, suggests `/compound` for major findings
- If MCP unavailable: skip and continue with remaining sources
- Verify tool names after install: ToolSearch "exa", ToolSearch "tavily"

## Components

### Commands
- `/research:code [topic]` — Inline code research
- `/research:deep [topic]` — Saved multi-source deep research

### Agents
- `research-conductor` — Routes deep research fan-out
- `code-researcher` — Inline code research routing

### Skills
- `research-patterns` — Conventions and source selection guide
```

### Phase 6: Marketplace Registration

In `.claude-plugin/marketplace.json`, add to `plugins` array:

```json
{"name": "yellow-research", "source": "./plugins/yellow-research"}
```

> **No `id` field** — marketplace.json rejects unknown keys. Only `name` and
> `source` are valid entry fields.

---

## Acceptance Criteria

### Functional

- [ ] `/research:code <query>` returns inline synthesis using EXA `get_code_context_exa` + Context7
- [ ] `/research:deep <topic>` saves markdown to `docs/research/<slug>.md`
- [ ] Conductor routes simple queries to 1 source, complex to 3+ in parallel
- [ ] Parallel Task MCP fires for complex topics; `get_result` retrieves async report
- [ ] Missing `docs/research/` directory is created automatically
- [ ] Slug collision appends `-2`, `-3` suffix
- [ ] If any MCP is unavailable, plugin degrades gracefully (continues with rest)
- [ ] All 4 MCPs visible in `/mcp` after plugin install

### Quality Gates

- [ ] All `.md` files use LF line endings (critical on WSL2 — `sed -i 's/\r$//'`)
- [ ] Agent files under 120 lines each
- [ ] All agent/command descriptions are single-line (no YAML folded scalars)
- [ ] `skill` frontmatter uses `user-invokable` (with k), not `user-invocable`
- [ ] `plugin.json` `repository` field is a plain string URL (not object)
- [ ] No unknown keys in `marketplace.json` (no `id` field)
- [ ] `pnpm validate:schemas` passes
- [ ] MCP tool names verified with `ToolSearch` after install; update `allowed-tools` if needed
- [ ] No `allowed-tools` wildcards (`mcp__*`) — all tools listed explicitly

---

## Risk Analysis

| Risk | Mitigation |
|------|------------|
| EXA `crawling_exa` / `web_search_advanced_exa` off by default | Smithery loads them; confirm via `/mcp` tool list |
| Tavily tool names — underscore vs hyphen | Verified from live session: underscore. Check with `/mcp` after install |
| Parallel Task HTTP auth fails | Confirmed: HTTP type + `headers` works natively. No mcp-remote needed |
| API key not set → MCP start fails | Document in CLAUDE.md + research-patterns; agent skips unavailable source |
| `docs/research/` doesn't exist | `/research:deep` creates dir before writing |
| Slug collision | Append `-2`, `-3` suffix if file exists |
| WSL2 CRLF on created files | `sed -i 's/\r$//'` all `.md` and `.sh` files after Write tool |
| MCP tool names wrong (ruvector pattern) | Verify with `ToolSearch` after install; update `allowed-tools` |
| Supply chain: `npx -y` always latest | Acceptable risk for personal plugin; add version pin if needed later |

---

## Implementation Order

1. `plugin.json` — manifest with all 4 MCP servers + correct `headers` for parallel
2. `CLAUDE.md` — plugin context (needed by all components)
3. `skills/research-patterns.md` — conventions (referenced by agents)
4. `agents/research/code-researcher.md`
5. `commands/research/code.md`
6. `agents/research/research-conductor.md`
7. `commands/research/deep.md`
8. `README.md`
9. Update `.claude-plugin/marketplace.json`
10. `pnpm validate:schemas`
11. **After install:** verify MCP tool names with `ToolSearch`; update `allowed-tools` if they differ

---

## Open Questions (Resolved)

1. ~~Parallel-task-MCP package~~ → Real HTTP service at parallel.ai; native headers auth
2. ~~EXA API key env var~~ → `EXA_API_KEY`
3. ~~Tavily npm package name~~ → `tavily-mcp`
4. ~~Perplexity env var~~ → `PERPLEXITY_API_KEY`
5. ~~EXA tool names~~ → `web_search_exa`, `get_code_context_exa`, `web_search_advanced_exa`, `crawling_exa`, `deep_researcher_start`, `deep_researcher_check`
6. ~~Slug confirmation~~ → Auto-name, no confirmation needed (YAGNI)
7. ~~Parallel auth method~~ → HTTP `headers: {"Authorization": "Bearer ${PARALLEL_API_KEY}"}` natively supported

---

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-21-yellow-research-plugin-brainstorm.md`
- Reference plugin (MCP-only): `plugins/yellow-linear/.claude-plugin/plugin.json`
- Reference plugin (complex): `plugins/yellow-ruvector/.claude-plugin/plugin.json`
- Agent pattern: `plugins/yellow-linear/agents/research/linear-explorer.md`
- Command pattern: `plugins/yellow-linear/commands/linear/create.md`

### Learnings Applied
- MCP tool name verification: `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md`
- Manifest validation gotchas: `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`

### External
- EXA MCP Server: https://github.com/exa-labs/exa-mcp-server
- Tavily MCP: https://github.com/tavily-ai/tavily-mcp
- Parallel Task MCP docs: https://docs.parallel.ai/integrations/mcp/task-mcp
- MCP Integration skill: `~/.claude/plugins/cache/claude-plugins-official/plugin-dev/aa296ec81e8c/skills/mcp-integration/SKILL.md`
