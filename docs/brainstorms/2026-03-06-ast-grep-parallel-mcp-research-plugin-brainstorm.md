# Brainstorm: Add ast-grep MCP to yellow-research and Verify Parallel Task MCP

**Date:** 2026-03-06
**Status:** Approved
**Chosen approach:** B -- Bundle ast-grep directly into yellow-research

---

## What We're Building

Bundle the **ast-grep MCP server** as a 5th MCP server in yellow-research's
`plugin.json`, providing AST-level structural code search to research workflows.
Additionally, add a **Parallel Task MCP connectivity check** to `/research:setup`
and clean up documentation around the existing `mcp__grep__searchGitHub`
references (which are a separate, unrelated tool from grep.app).

### Deliverables

1. Add ast-grep MCP server entry to `plugins/yellow-research/.claude-plugin/plugin.json`
2. Add all 4 ast-grep tools to research agent `allowed-tools` lists
3. Document `uv` and `ast-grep` binary as prerequisites in CLAUDE.md
4. Add ast-grep binary/uv availability check to `/research:setup`
5. Add Parallel Task MCP connectivity check to `/research:setup`
6. Clarify `mcp__grep__searchGitHub` references (different tool, stays as-is)
7. Update research-conductor triage logic to incorporate ast-grep tools

---

## Why This Approach

### Approach chosen: B -- Bundle in yellow-research

The user chose to bundle ast-grep directly into yellow-research rather than
creating a separate plugin. While a separate plugin (Approach A) follows the
established pattern of yellow-morph/WarpGrep, the user prefers the simpler
wiring of having all research-relevant MCP servers in a single plugin.json.

**Key tradeoffs accepted:**
- Mixed runtime: `uvx` (Python) alongside `npx` (Node) in one plugin
- Users who only want web research APIs will need `uv` + `ast-grep` installed,
  or accept graceful degradation (ast-grep tools unavailable, other tools work)
- ast-grep tools are less easily available to non-research plugins (they would
  need cross-plugin `allowed-tools` references back to yellow-research)

**Why not Approach A (separate yellow-ast-grep plugin):**
- User wants minimal plugin count and simpler integration
- Avoids creating a new plugin with its own package.json, CLAUDE.md, README

**Why not Approach C (defer ast-grep, health checks only):**
- User wants ast-grep integration now, not deferred
- There is a concrete use case: AST-aware code search in research workflows

### Parallel Task MCP stays in yellow-research

The Parallel Task MCP (`https://task-mcp.parallel.ai/mcp`) remains in
yellow-research. It is a research orchestration primitive whose tools
(`createDeepResearch`, `createTaskGroup`, `getStatus`, `getResultMarkdown`)
are tightly coupled to the research-conductor's async fan-out logic. It has
zero local dependencies (HTTP server, no binary, no API key) and no value
outside research workflows. Extracting it would create a plugin with a single
HTTP entry and no commands -- pure overhead.

---

## Key Decisions

### 1. ast-grep MCP server configuration

**Package:** `ast-grep-mcp` from `git+https://github.com/ast-grep/ast-grep-mcp`
**Runtime:** `uvx` (Python, via `uv`)
**Binary prerequisite:** `ast-grep` (installed via `brew install ast-grep`,
`cargo install ast-grep --locked`, or `nix-shell -p ast-grep`)

**plugin.json entry:**
```json
"ast-grep": {
  "command": "uvx",
  "args": [
    "--from",
    "git+https://github.com/ast-grep/ast-grep-mcp",
    "ast-grep-server"
  ]
}
```

**Tool names when bundled** (plugin-namespaced):
- `mcp__plugin_yellow-research_ast-grep__find_code`
- `mcp__plugin_yellow-research_ast-grep__find_code_by_rule`
- `mcp__plugin_yellow-research_ast-grep__dump_syntax_tree`
- `mcp__plugin_yellow-research_ast-grep__test_match_code_rule`

### 2. ast-grep is NOT the same as grep.app searchGitHub

During the brainstorm, a critical clarification emerged: the user wanted
**ast-grep** (AST-level structural code search, local), not the **grep.app
MCP** (`mcp__grep__searchGitHub`, GitHub web code search, remote).

These are completely different tools:

| Aspect | ast-grep MCP | grep.app MCP |
|--------|-------------|--------------|
| What it does | Local AST pattern matching | GitHub code search via web |
| Tool name | `find_code`, `find_code_by_rule`, etc. | `searchGitHub` |
| Runtime | `uvx` (Python) + `ast-grep` binary | Global MCP config |
| Scope | Files on disk in current project | All public GitHub repos |
| API key | None | None |

**Decision:** The existing `mcp__grep__searchGitHub` references in CLAUDE.md,
`research-conductor.md`, `deep.md`, and `setup.md` remain as-is. They refer
to a different tool. CLAUDE.md documentation should be updated to clarify the
distinction.

### 3. All 4 ast-grep tools exposed to research agents

All 4 tools will be added to the `allowed-tools` lists in:
- `plugins/yellow-research/agents/research/research-conductor.md`
- `plugins/yellow-research/commands/research/deep.md`
- `plugins/yellow-research/commands/research/code.md` (if it exists)

The research-conductor will decide which tools to use based on query complexity:
- `find_code` -- simple structural pattern searches during code research
- `find_code_by_rule` -- complex multi-condition AST searches
- `dump_syntax_tree` -- when the conductor needs to understand AST structure
  to build a better search query
- `test_match_code_rule` -- when the conductor wants to validate a rule before
  running it across the codebase

### 4. Research-conductor triage updates

The existing triage logic (Simple/Moderate/Complex) should be extended:

- **When researching code patterns or codebase structure:** Use ast-grep tools
  alongside or instead of text-based search
- **When the query involves "find all X that Y"** (structural code patterns):
  Prefer `find_code_by_rule` over text grep
- **When building complex AST rules:** Use `dump_syntax_tree` first to
  understand structure, then `test_match_code_rule` to validate, then
  `find_code_by_rule` to search

This does NOT change the Simple/Moderate/Complex fan-out for web research.
ast-grep is a **code search** tool that complements the existing **web research**
tools.

### 5. Parallel Task MCP health check in /research:setup

Add a new entry to Step 3.5 (MCP Source Health Checks) in `setup.md`:

```text
**Parallel Task MCP** (bundled HTTP — async research orchestration):

ToolSearch keyword: "createDeepResearch"
Tool name: mcp__plugin_yellow-research_parallel__createDeepResearch
Test: ToolSearch probe only (do not create an actual task).
If tool is found in ToolSearch results, record as ACTIVE.
If not found, record as UNAVAILABLE.
```

The health check should be ToolSearch-only (no live call) because:
- `createDeepResearch` creates real tasks with real compute cost
- `getStatus` requires a valid task_id
- Finding the tool in ToolSearch confirms the HTTP MCP connection is live

### 6. ast-grep health check in /research:setup

Add ast-grep checks to both Step 1 (prerequisites) and Step 3.5 (MCP sources):

**Step 1 addition:**
```bash
command -v ast-grep >/dev/null 2>&1 && printf 'ast-grep: ok\n' || printf 'ast-grep: NOT FOUND\n'
command -v uv >/dev/null 2>&1 && printf 'uv:       ok\n' || printf 'uv:       NOT FOUND\n'
```

**Step 3.5 addition:**
```text
**ast-grep MCP** (bundled stdio — AST structural code search):

ToolSearch keyword: "find_code"
Tool name: mcp__plugin_yellow-research_ast-grep__find_code
Test call: mcp__plugin_yellow-research_ast-grep__find_code
  with pattern: "function $NAME() {}", lang: "javascript", path: "."
```

### 7. CLAUDE.md documentation updates

Update the optional dependencies section to:
- Clarify that `mcp__grep__searchGitHub` is the **grep.app** GitHub code search
  (global MCP, optional, separate from ast-grep)
- Document ast-grep as a **bundled** MCP server (not optional -- it ships with
  the plugin but requires system prerequisites)
- Add `uv` and `ast-grep` binary to the prerequisites section
- Note graceful degradation: if `ast-grep` binary is missing, the MCP server
  will fail to start but other servers are unaffected

---

## Open Questions

1. **ast-grep version pinning:** The current `uvx` invocation pulls from
   `git+https://github.com/ast-grep/ast-grep-mcp` (latest main). Should we pin
   to a specific commit or tag for reproducibility? The repo has no releases/tags
   yet (0 releases on GitHub). Monitor for a PyPI package or versioned releases.

2. **ast-grep binary version:** Should `/research:setup` check the ast-grep
   binary version and warn if it is below a minimum? The MCP server README does
   not specify a minimum version.

3. **sgconfig.yaml support:** ast-grep MCP supports custom configuration via
   `--config` flag or `AST_GREP_CONFIG` env var. Should we expose this in
   plugin.json's env section for users who have project-specific ast-grep configs?

4. **Cross-plugin consumption:** If other plugins (yellow-debt, yellow-review,
   yellow-semgrep) want ast-grep tools, they will need cross-plugin
   `allowed-tools` references like
   `mcp__plugin_yellow-research_ast-grep__find_code`. This works but couples
   those plugins to yellow-research. If demand grows, revisit extracting to a
   standalone yellow-ast-grep plugin (Approach A from this brainstorm).

5. **grep.app searchGitHub future:** The `mcp__grep__searchGitHub` tool is
   currently a global MCP config with no plugin owning it. Should it eventually
   be bundled into a plugin, or is global config acceptable long-term? Not
   blocking for this work.

---

## Brainstorm Dialogue Summary

### Phase 0: Topic Confirmation
- Initial topic: "Add Grep MCP to yellow-research and confirm Parallel Task MCP"
- Refined: user clarified they want ast-grep (AST structural search), NOT
  grep.app (GitHub code search)

### Phase 1: Questions

**Q1: Clean break vs backward compat for tool naming?**
A: Clean break -- bundle in yellow-research only, update all allowed-tools
references, remove global config instructions. (This was before the ast-grep
clarification; the principle still applies to ast-grep bundling.)

**Q2: What is the exact package for "Grep MCP"?**
A: User clarified this is **ast-grep MCP** from
`https://github.com/ast-grep/ast-grep-mcp`, not grep.app searchGitHub.

**Q3: Bundle in yellow-research vs separate plugin?**
A: User chose bundle (Approach B). Mixed runtime (uvx + npx) is acceptable.
Recommendation was separate plugin (Approach A) based on yellow-morph precedent,
but user preferred simpler wiring.

**Q4: Which ast-grep tools to expose to research?**
A: All 4 tools (`find_code`, `find_code_by_rule`, `dump_syntax_tree`,
`test_match_code_rule`). Let research-conductor decide based on complexity.

**Q5: What does "confirm Parallel Task MCP working" mean?**
A: Add connectivity check to `/research:setup` (ToolSearch probe, no live task
creation). Also confirmed Parallel Task MCP should stay in yellow-research
(not its own plugin) because it is a research orchestration primitive with
zero local dependencies and no value outside research workflows.

### Research

**External research (RESEARCH_ROUND=1):** Crawled
`https://github.com/ast-grep/ast-grep-mcp` via EXA. Key findings:
- Python-based server using FastMCP framework
- 308 stars, MIT license, 53 commits
- Requires `ast-grep` binary + `uv` runtime
- 4 tools: `dump_syntax_tree`, `test_match_code_rule`, `find_code`,
  `find_code_by_rule`
- Run via `uvx --from git+https://github.com/ast-grep/ast-grep-mcp ast-grep-server`
- No API keys, no env vars required (optional `AST_GREP_CONFIG`)
- No PyPI package or versioned releases yet

### Approaches Considered

| Approach | Description | Chosen? |
|----------|-------------|---------|
| A: Separate yellow-ast-grep plugin | Own plugin.json, optional research dep | No |
| B: Bundle in yellow-research | 5th MCP server in existing plugin.json | Yes |
| C: Defer, health checks only | No ast-grep, just setup improvements | No |

---

## Implementation Checklist

- [ ] Add `ast-grep` MCP server entry to `plugins/yellow-research/.claude-plugin/plugin.json`
- [ ] Add 4 ast-grep tools to `allowed-tools` in `research-conductor.md`
- [ ] Add 4 ast-grep tools to `allowed-tools` in `research/deep.md`
- [ ] Add 4 ast-grep tools to `allowed-tools` in `research/code.md` (if exists)
- [ ] Update `research-conductor.md` triage logic for ast-grep tool usage
- [ ] Add `ast-grep` and `uv` prerequisite checks to `/research:setup` Step 1
- [ ] Add ast-grep MCP health check to `/research:setup` Step 3.5
- [ ] Add Parallel Task MCP health check to `/research:setup` Step 3.5
- [ ] Update `/research:setup` Step 4 report table (add ast-grep + Parallel rows)
- [ ] Update `/research:setup` Step 5 install instructions for ast-grep
- [ ] Update CLAUDE.md prerequisites section (add `uv`, `ast-grep` binary)
- [ ] Update CLAUDE.md optional dependencies to clarify grep.app vs ast-grep
- [ ] Update CLAUDE.md MCP servers section to list ast-grep as bundled
- [ ] Update `package.json` keywords if applicable
- [ ] Test: verify `uvx --from git+https://github.com/ast-grep/ast-grep-mcp ast-grep-server` starts
- [ ] Test: run `/research:setup` and confirm all health checks pass
- [ ] Test: run `/research:deep` on a code-related topic and confirm ast-grep tools are available
