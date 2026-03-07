# Feature: Add ast-grep MCP to yellow-research & Parallel Task MCP Health Check

## Problem Statement

The yellow-research plugin bundles 4 MCP servers (Perplexity, Tavily, EXA, Parallel Task)
but lacks AST-level structural code search. The ast-grep MCP server provides pattern-based
code search using abstract syntax trees — valuable for research workflows that analyze
codebases. Additionally, the Parallel Task MCP has no health check in `/research:setup`,
and the `mcp__grep__searchGitHub` references in docs need clarification (it is a separate
tool from ast-grep).

<!-- deepen-plan: external -->
> **Research:** ast-grep MCP handles missing `ast-grep` binary gracefully — the check is
> **lazy** (not at startup). The server starts successfully and advertises all 4 tools even
> if `ast-grep` is not installed. Tools fail with a descriptive `RuntimeError` on first
> invocation: `"Command 'ast-grep' not found. Please ensure ast-grep is installed and in PATH."`
> The MCP server process continues running after this error.
<!-- /deepen-plan -->

## Current State

- `plugin.json` has 4 MCP servers: `perplexity` (npx), `tavily` (npx), `exa` (npx), `parallel` (HTTP)
- `research-conductor.md` and `deep.md` reference `mcp__grep__searchGitHub` (grep.app, unrelated to ast-grep)
- `/research:setup` checks 4 MCP sources (Context7, Grep MCP, WarpGrep, DeepWiki) but NOT Parallel Task
- ast-grep MCP is Python-based (`uvx`), requires `ast-grep` binary + `uv` runtime
- Source: https://github.com/ast-grep/ast-grep-mcp — 4 tools, no API key needed

<!-- deepen-plan: external -->
> **Research:** ast-grep-mcp requires **Python >= 3.13** (hard constraint in `pyproject.toml`:
> `requires-python = ">=3.13"`). This is a strict constraint — `uvx` will fail to install if
> only Python 3.12 or earlier is available. This should be documented as a prerequisite
> alongside `uv` and the `ast-grep` binary.
<!-- /deepen-plan -->

## Proposed Solution

Bundle ast-grep MCP as a 5th server in yellow-research's `plugin.json` using `uvx`.
Add all 4 tools to research agent allowed-tools. Add health checks for both ast-grep
and Parallel Task MCP to `/research:setup`. Update CLAUDE.md documentation.

<!-- deepen-plan: codebase -->
> **Codebase:** The `yellow-semgrep` plugin already uses `uvx` as an MCP server command
> (`plugins/yellow-semgrep/.claude-plugin/plugin.json`), confirming `uvx` is an accepted
> pattern in this ecosystem. However, semgrep-mcp is a published PyPI package, whereas
> ast-grep-mcp uses a `git+https://` URL — less stable but the only option available.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** ast-grep-mcp is **NOT published to PyPI**. The package name in
> `pyproject.toml` is `sg-mcp` v0.1.0 (pre-release). Git+https is the only installation
> method. If PyPI publication occurs, the name would likely be `sg-mcp`. Pinning to a
> specific commit is possible: `uvx --from "git+https://github.com/ast-grep/ast-grep-mcp@COMMITHASH" ast-grep-server`
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The server explicitly ignores SIGINT for multi-session stability:
> `signal.signal(signal.SIGINT, sigint_handler)`. This means it survives Claude Code
> session restarts without being killed — good for long-running MCP server usage.
> Transport modes: `stdio` (default, correct for plugin.json) and `sse` (port 3101).
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Plugin Configuration

- [ ] 1.1: Add ast-grep MCP server entry to `plugins/yellow-research/.claude-plugin/plugin.json`
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

<!-- deepen-plan: codebase -->
> **Codebase:** **Risk: hyphenated server key is untested.** All existing server keys in the
> repo are single words (`perplexity`, `tavily`, `exa`, `parallel`, `morph`, `semgrep`,
> `ruvector`, `context7`). The `ast-grep` key introduces a hyphen. While Claude Code uses
> `__` as delimiter (not hyphens), this has not been empirically verified. **Recommendation:**
> After adding the entry, start the MCP server and check ToolSearch output to confirm tool
> names resolve as `mcp__plugin_yellow-research_ast-grep__find_code`. If hyphens cause
> issues, consider `astgrep` (no hyphen) as the server key.
<!-- /deepen-plan -->

- [ ] 1.2: Update `plugins/yellow-research/package.json` — add `"ast-grep"` to keywords, update description

<!-- deepen-plan: codebase -->
> **Codebase:** The current `package.json` has NO `keywords` field (only `name`, `version`,
> `private`, `description`). A `keywords` array needs to be **created**, not updated.
<!-- /deepen-plan -->

### Phase 2: Agent & Command Wiring

- [ ] 2.1: Add 4 ast-grep tools to `allowed-tools` in `plugins/yellow-research/agents/research/research-conductor.md`:
  - `mcp__plugin_yellow-research_ast-grep__find_code`
  - `mcp__plugin_yellow-research_ast-grep__find_code_by_rule`
  - `mcp__plugin_yellow-research_ast-grep__dump_syntax_tree`
  - `mcp__plugin_yellow-research_ast-grep__test_match_code_rule`
- [ ] 2.2: Update research-conductor triage logic — add guidance for when to use ast-grep:
  - Code pattern queries → prefer `find_code` / `find_code_by_rule` over text grep
  - Complex AST rules → `dump_syntax_tree` first, `test_match_code_rule` to validate, then `find_code_by_rule`
  - ast-grep is a **code search** complement, does NOT change Simple/Moderate/Complex web research fan-out
- [ ] 2.3: Add 4 ast-grep tools to `allowed-tools` in `plugins/yellow-research/commands/research/deep.md`
- [ ] 2.4: Add 4 ast-grep tools to `allowed-tools` in `plugins/yellow-research/agents/research/code-researcher.md`
- [ ] 2.5: Update code-researcher source routing table — add row for AST/structural code patterns → ast-grep tools
- [ ] 2.6: Add 4 ast-grep tools to `allowed-tools` in `plugins/yellow-research/commands/research/code.md`

<!-- deepen-plan: codebase -->
> **Codebase:** **Gap found:** `commands/research/code.md` was missing from the original file
> list. It has its own `allowed-tools` frontmatter (lines 5-17) with explicit MCP tool entries
> (EXA, Context7, grep, Perplexity). Since it lists tools directly (not just delegating to
> the agent), ast-grep tools are needed here too. Added as task 2.6.
<!-- /deepen-plan -->

### Phase 3: Setup Health Checks

- [ ] 3.1: Add `ast-grep` binary, `uv`, and Python version prerequisite checks to `/research:setup` Step 1:
  ```bash
  command -v ast-grep >/dev/null 2>&1 && printf 'ast-grep: ok\n' || printf 'ast-grep: NOT FOUND\n'
  command -v uv >/dev/null 2>&1 && printf 'uv:       ok\n' || printf 'uv:       NOT FOUND\n'
  python3 --version 2>/dev/null | grep -qE '3\.(1[3-9]|[2-9][0-9])' && printf 'python:   ok (>=3.13)\n' || printf 'python:   NEEDS >=3.13\n'
  ```

<!-- deepen-plan: external -->
> **Research:** Python >= 3.13 is a hard requirement. The setup check should verify this
> since `uvx` will fail to install ast-grep-mcp without it. The `.python-version` file in
> the ast-grep-mcp repo also specifies `3.13`.
<!-- /deepen-plan -->

- [ ] 3.2: Add ast-grep MCP health check to Step 3.5:
  ```text
  **ast-grep MCP** (bundled stdio — AST structural code search):
  ToolSearch keyword: "find_code"
  Tool name: mcp__plugin_yellow-research_ast-grep__find_code
  Test call: find_code with pattern: "function $NAME() {}", lang: "javascript"
  ```

<!-- deepen-plan: external -->
> **Research:** Since the binary check is lazy (server starts even without `ast-grep`),
> the health check test call will be the true validation. If `ast-grep` is missing, the
> test call will fail with `"Command 'ast-grep' not found"` — record as FAIL with a note
> to install the binary. The ToolSearch probe alone is insufficient to confirm functionality.
<!-- /deepen-plan -->

- [ ] 3.3: Add Parallel Task MCP health check to Step 3.5:
  ```text
  **Parallel Task MCP** (bundled HTTP — async research orchestration):
  ToolSearch keyword: "createDeepResearch"
  Tool name: mcp__plugin_yellow-research_parallel__createDeepResearch
  Test: ToolSearch probe only (do not create actual tasks — they have compute cost)
  ```

<!-- deepen-plan: codebase -->
> **Codebase:** The ToolSearch-only approach for Parallel Task is a justified deviation from
> the existing pattern (all 4 current checks do both ToolSearch + test call). Parallel Task
> tools create real tasks with real compute cost and `getStatus` requires a valid task_id.
> Document this rationale in setup.md so future maintainers understand why.
<!-- /deepen-plan -->

- [ ] 3.4: Update Step 4 report table — add ast-grep and Parallel Task rows to MCP Sources section, update source counts (now 6 MCP sources, not 4)
- [ ] 3.5: Update Step 5 install instructions — add ast-grep/uv install guidance:
  ```text
  ast-grep:  brew install ast-grep  (or: cargo install ast-grep --locked, or: pip install ast-grep-cli)
  uv:        curl -LsSf https://astral.sh/uv/install.sh | sh
  python:    Requires >= 3.13 (check with python3 --version)
  ```

<!-- deepen-plan: external -->
> **Research:** The `ast-grep` binary can also be installed via `pip install ast-grep-cli`
> (currently at v0.41.0 on PyPI). This is an additional install path worth documenting
> alongside brew and cargo.
<!-- /deepen-plan -->

- [ ] 3.6: Add ast-grep and Parallel Task to `allowed-tools` in `plugins/yellow-research/commands/research/setup.md` frontmatter

### Phase 4: Documentation

- [ ] 4.1: Update `plugins/yellow-research/CLAUDE.md`:
  - Add `ast-grep` section under MCP Servers listing 4 tools
  - Add `uv`, Python >= 3.13, and `ast-grep` binary to prerequisites section
  - Note graceful degradation: missing `ast-grep` binary → server starts but tools fail on invocation; other servers unaffected
  - Clarify in optional dependencies that `mcp__grep__searchGitHub` is grep.app (GitHub web search), distinct from ast-grep (local AST search)
- [ ] 4.2: Update `plugins/yellow-research/README.md` — add ast-grep row to MCP servers table and update description line

<!-- deepen-plan: codebase -->
> **Codebase:** README.md has an MCP servers table at lines 59-67 with 4 rows. The
> description at line 3 says "Bundles Perplexity, Tavily, EXA, and Parallel Task MCP
> servers" — both need updating to include ast-grep as the 5th server.
<!-- /deepen-plan -->

- [ ] 4.3: Update `plugins/yellow-research/.claude-plugin/plugin.json` description to mention ast-grep
- [ ] 4.4: Update `plugins/yellow-research/skills/research-patterns/SKILL.md` source selection guide table — add ast-grep row

<!-- deepen-plan: codebase -->
> **Codebase:** **Gap found:** The research-patterns skill at
> `plugins/yellow-research/skills/research-patterns/SKILL.md` has a "Source Selection Guide"
> table (lines 57-65) and "MCP Tool Name Verification" section (lines 105-121). Both should
> be updated with ast-grep entries. Added as task 4.4.
<!-- /deepen-plan -->

- [ ] 4.5: Update `.claude-plugin/marketplace.json` description for yellow-research entry

<!-- deepen-plan: codebase -->
> **Codebase:** **Gap found:** The marketplace.json description (line 116) says "Deep research
> plugin with Perplexity, Tavily, EXA, and Parallel Task MCP servers." This must stay in sync
> with plugin.json per the three-way versioning model. Added as task 4.5.
<!-- /deepen-plan -->

### Phase 5: Versioning & CI

- [ ] 5.1: Run `pnpm changeset` — select yellow-research with `minor` bump type (new MCP server = new capability)
- [ ] 5.2: Run `pnpm apply:changesets` to apply version bump
- [ ] 5.3: Run `node scripts/sync-manifests.js` to propagate version to plugin.json and marketplace.json

<!-- deepen-plan: codebase -->
> **Codebase:** **Gap found:** Per the repo's `docs/CLAUDE.md`: "Always run `pnpm changeset`
> before committing plugin file changes. CI blocks PRs that modify `plugins/*/` without a
> `.changeset/*.md` file." A `minor` changeset is required (adding a new MCP server is a new
> capability). Added as Phase 5.
<!-- /deepen-plan -->

## Technical Details

### Files to Modify

- `plugins/yellow-research/.claude-plugin/plugin.json` — add ast-grep server entry + update description
- `plugins/yellow-research/package.json` — update description, add keywords array
- `plugins/yellow-research/agents/research/research-conductor.md` — allowed-tools + triage logic
- `plugins/yellow-research/agents/research/code-researcher.md` — allowed-tools + source routing
- `plugins/yellow-research/commands/research/deep.md` — allowed-tools
- `plugins/yellow-research/commands/research/code.md` — allowed-tools
- `plugins/yellow-research/commands/research/setup.md` — health checks + allowed-tools
- `plugins/yellow-research/skills/research-patterns/SKILL.md` — source selection guide
- `plugins/yellow-research/CLAUDE.md` — documentation
- `plugins/yellow-research/README.md` — MCP server table + description
- `.claude-plugin/marketplace.json` — yellow-research description

### No Files to Create

All changes are modifications to existing files.

### Dependencies

- `ast-grep` binary (system) — `brew install ast-grep` or `cargo install ast-grep --locked` or `pip install ast-grep-cli`
- `uv` (system) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Python >= 3.13 (system) — hard requirement from ast-grep-mcp's `pyproject.toml`
- `ast-grep-mcp` (Python, fetched by uvx at runtime) — `git+https://github.com/ast-grep/ast-grep-mcp`

### Tool Names When Bundled

```
mcp__plugin_yellow-research_ast-grep__find_code
mcp__plugin_yellow-research_ast-grep__find_code_by_rule
mcp__plugin_yellow-research_ast-grep__dump_syntax_tree
mcp__plugin_yellow-research_ast-grep__test_match_code_rule
```

## Acceptance Criteria

1. `plugin.json` contains ast-grep server entry with `uvx` command
2. All 4 ast-grep tools appear in allowed-tools for research-conductor, code-researcher, deep.md, and code.md
3. `/research:setup` checks for `ast-grep` binary, `uv`, Python >= 3.13, ast-grep MCP tools, and Parallel Task MCP tools
4. Setup report table shows 6 MCP sources (Context7, Grep MCP, WarpGrep, DeepWiki, ast-grep, Parallel Task)
5. CLAUDE.md documents ast-grep as bundled, lists prerequisites (including Python >= 3.13), and clarifies grep.app vs ast-grep distinction
6. Research-conductor knows when to use ast-grep tools (code pattern queries)
7. Graceful degradation: missing ast-grep binary does not affect other MCP servers (server starts, tools fail on invocation)
8. SKILL.md source selection guide includes ast-grep row
9. marketplace.json description updated
10. Changeset created with minor bump

## Edge Cases

- `ast-grep` binary missing → MCP server starts successfully but tools fail on invocation with descriptive error; setup reports FAIL; other servers unaffected
- `uv` missing → `uvx` command not found; ast-grep server doesn't start; other servers unaffected
- Python < 3.13 → `uvx` fails to install ast-grep-mcp; setup reports NEEDS >=3.13
- No versioned releases of ast-grep-mcp → `uvx` pulls latest from main; monitor for PyPI package (would be `sg-mcp`)
- `mcp__grep__searchGitHub` references stay as-is — different tool, different purpose
- Hyphenated server key `ast-grep` — untested in this repo; verify empirically after adding; fallback: use `astgrep`

<!-- deepen-plan: external -->
> **Research:** The `ast-grep` binary check is lazy — the MCP server starts and advertises
> all 4 tools even without the binary installed. Errors only surface on tool invocation.
> This means ToolSearch will find the tools, but health check test calls will fail.
> The setup health check design correctly uses a test call (not just ToolSearch) to detect this.
<!-- /deepen-plan -->

## References

- Brainstorm: `docs/brainstorms/2026-03-06-ast-grep-parallel-mcp-research-plugin-brainstorm.md`
- ast-grep MCP repo: https://github.com/ast-grep/ast-grep-mcp
- ast-grep MCP pyproject.toml: package name `sg-mcp`, requires Python >= 3.13, entry point `ast-grep-server = "main:run_mcp_server"`
- Parallel Task MCP: https://task-mcp.parallel.ai/mcp
- ast-grep-cli on PyPI: https://pypi.org/project/ast-grep-cli/ (v0.41.0, alternative binary install)
- Recall finding (score 0.70): MCP cold-start latency matters — ToolSearch finding a tool doesn't guarantee server is running
- Codebase precedent: yellow-semgrep uses `uvx` for its MCP server (`plugins/yellow-semgrep/.claude-plugin/plugin.json`)
