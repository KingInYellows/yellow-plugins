# Feature: yellow-mempalace Plugin

## Problem Statement

MemPalace is a new open-source AI memory system (14.2k stars, MIT license) that
provides structured long-term memory using the Method of Loci metaphor. It
stores verbatim content in a navigable palace structure (wings/rooms/halls) with
a temporal knowledge graph — complementing ruvector's real-time coding
intelligence with cross-session, cross-project knowledge persistence.

The plugin wraps mempalace's built-in MCP server (19 tools) and hooks system,
following established yellow-plugins conventions.

**Research doc:** `docs/research/mempalace-memory-tool-vs-ruvector.md`

## Current State

No mempalace integration exists. RuVector handles real-time memory (passive
capture, per-prompt injection, semantic code search). MemPalace addresses a
different problem: "what did we decide 3 months ago?" — long-term verbatim
recall, conversation mining, and temporal fact tracking.

## Proposed Solution

Build a standalone `yellow-mempalace` plugin following the established plugin
conventions. The MCP server is the primary integration point (19 tools, stdio
transport). Hooks are deferred until mempalace's shell injection fix (#110)
ships.

### Key Decisions

1. **Standalone plugin** (not a ruvector bridge) — mempalace has enough surface
   area (19 MCP tools, KG, mining) to justify its own plugin
2. **MCP-first** — the `python -m mempalace.mcp_server` stdio server is the
   canonical integration path
3. **No hooks in Phase 1** — mempalace's hook system has a known shell injection
   vulnerability (#110). Defer hooks until the fix ships and is verified
4. **pipx-first install** — follows the established Python binary install
   convention (PEP 668 safe)
5. **No AAAK compression** — the experimental lossy format regresses benchmark
   performance. Use verbatim mode only.

<!-- deepen-plan: external -->
> **Research:** Independent analysis by Penfield Labs and Leonard Lin (lhl)
> raised significant concerns about mempalace's claims: (1) the "100% perfect
> score on LongMemEval" benchmark methodology is disputed (GitHub Issue #29),
> (2) AAAK "30x lossless compression" is functionally lossy — `decode()` cannot
> reconstruct original text (Issue #27), (3) "contradiction detection" is
> marketed as a feature but `knowledge_graph.py` contains zero occurrences of
> the word "contradict" — only exact-match dedup exists, (4) v3.0.0 version
> inflation — this is the first public release. The 14k stars in 48 hours are
> attributed primarily to celebrity association (co-creator Milla Jovovich).
> These risks reinforce the plan's conservative approach (MCP-only, no hooks,
> no AAAK). See: [Penfield Labs analysis](https://penfieldlabs.substack.com/p/milla-jovovich-just-released-an-ai),
> [lhl independent analysis](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md)
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Scaffold & MCP Server

- [ ] 1.1: Create directory structure
  ```
  plugins/yellow-mempalace/
  ├── .claude-plugin/plugin.json
  ├── CLAUDE.md
  ├── README.md
  ├── package.json
  ├── commands/mempalace/
  ├── agents/mempalace/
  ├── skills/mempalace-conventions/
  └── scripts/
  ```

- [ ] 1.2: Write `plugin.json` with MCP server config
  ```json
  {
    "name": "yellow-mempalace",
    "version": "1.0.0",
    "description": "Structured long-term memory with temporal knowledge graph via MemPalace",
    "author": {
      "name": "KingInYellows",
      "url": "https://github.com/KingInYellows"
    },
    "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-mempalace",
    "repository": "https://github.com/KingInYellows/yellow-plugins",
    "license": "MIT",
    "keywords": ["memory", "knowledge-graph", "ai-memory", "mcp", "chromadb"],
    "mcpServers": {
      "mempalace": {
        "command": "mempalace",
        "args": ["mcp"],
        "env": {}
      }
    }
  }
  ```
  Note: No hooks in Phase 1. No env vars needed (mempalace auto-discovers
  palace in cwd or `~/.mempalace/`).

<!-- deepen-plan: codebase -->
> **Codebase:** No existing plugin uses `"command": "python", "args": ["-m", ...]`.
> All Python-based MCP servers invoke the CLI binary directly:
> `yellow-semgrep` uses `"command": "semgrep", "args": ["mcp"]`,
> `yellow-research` uses `"command": "uvx"` for its Python MCP.
> Changed to `"command": "mempalace", "args": ["mcp"]` to match the established
> pattern. If `mempalace mcp` is not a valid subcommand, fall back to
> `"command": "uvx", "args": ["mempalace", "mcp"]`.
> Also added `author`, `homepage`, `repository`, `license`, `keywords` —
> these are not schema-required (only `name`, `version`, `description`, `author`
> are required per `schemas/plugin.schema.json`) but are present in all 16
> existing plugins as de facto convention.
<!-- /deepen-plan -->

- [ ] 1.3: Write `package.json` (name, version, private: true)

- [ ] 1.4: Write `scripts/install-mempalace.sh`
  - `set -Eeuo pipefail`, color helpers, cleanup trap
  - Check if `mempalace` already installed + version check
  - pipx-first: `pipx install mempalace`
  - Fallback: `python3 -m pip install mempalace`
  - Detect PEP 668 "externally-managed-environment" error
  - Verify binary in PATH after install
  - Smoke test: `mempalace --version`
  - Verify MCP entrypoint: `mempalace mcp --help` or `python -m mempalace.mcp_server --help`

<!-- deepen-plan: codebase -->
> **Codebase:** The install script should follow the exact pattern at
> `plugins/yellow-semgrep/scripts/install-semgrep.sh` (256 lines):
> pipx-first (lines 163-167), pip fallback (lines 173-205), PEP 668
> detection (line 199), `version_gte()` semver comparison (POSIX-compatible),
> PATH check for `~/.local/bin`. The install script must also verify the MCP
> subcommand exists — if `mempalace mcp` is not a valid CLI subcommand,
> the plugin.json must fall back to `"command": "python", "args": ["-m",
> "mempalace.mcp_server"]` or `"command": "uvx", "args": ["mempalace"]`.
> The setup command should test this during Step 3 (MCP verification).
<!-- /deepen-plan -->

### Phase 2: Setup Command

- [ ] 2.1: Write `commands/mempalace/setup.md`
  - Step 0: Check if `mempalace` CLI is installed
  - Step 0b: If not found, AskUserQuestion to offer install, run install script
  - Step 1: Validate prerequisites (python3 required, curl optional)
  - Step 2: Check if palace is initialized (`mempalace status` or check for
    `.mempalace/` dir)
  - Step 2b: If not initialized, AskUserQuestion to offer `mempalace init .`
  - Step 3: Verify MCP tools via ToolSearch (`"+mempalace"`)
  - Step 4: Report summary table

### Phase 3: Core Commands

- [ ] 3.1: Write `commands/mempalace/status.md`
  - Call `mempalace_status` MCP tool
  - Display palace overview: wing count, room count, drawer count, KG stats
  - Show storage path and version

- [ ] 3.2: Write `commands/mempalace/search.md`
  - Accept query argument
  - Optional: `--wing`, `--room`, `--hall` filters
  - Call `mempalace_search` (or `search_wing`/`search_room`/`search_hall`)
  - Display results with similarity scores and source references
  - Limit default to 5 results

- [ ] 3.3: Write `commands/mempalace/mine.md`
  - Accept path argument (directory to mine)
  - Optional: `--mode` (projects|convos|general)
  - Call `mempalace_mine` MCP tool or fallback to CLI `mempalace mine`
  - Show progress and summary (drawers created, wings/rooms populated)

- [ ] 3.4: Write `commands/mempalace/kg.md`
  - Subcommand-style: query, add, invalidate, timeline
  - `query`: entity lookup with optional `--as-of` date filter
  - `add`: create triple (subject, predicate, object, valid_from)
  - `invalidate`: end a fact's validity
  - `timeline`: chronological entity history
  - Call corresponding `mempalace_kg_*` MCP tools

- [ ] 3.5: Write `commands/mempalace/navigate.md`
  - Browse palace structure: list wings → rooms → drawers
  - Traverse connections between wings via tunnels
  - Call `mempalace_list_wings`, `mempalace_list_rooms`,
    `mempalace_traverse`, `mempalace_find_tunnels`

### Phase 4: Agents

- [ ] 4.1: Write `agents/mempalace/palace-navigator.md`
  - Triggers: "browse palace", "show wings", "what rooms exist",
    "find connections between X and Y"
  - Tools: ToolSearch, Read + mempalace read/search/graph MCP tools
  - Navigates palace structure and presents information

- [ ] 4.2: Write `agents/mempalace/memory-archivist.md`
  - Triggers: "save to palace", "file this memory", "record this decision",
    "add to knowledge graph"
  - Tools: ToolSearch, Read, Grep, AskUserQuestion + mempalace write/KG MCP
    tools
  - Organizes and files new memories into appropriate wings/rooms
  - Checks for duplicates before filing
  - Manages KG triples (add, invalidate)

<!-- deepen-plan: codebase -->
> **Codebase:** Agent frontmatter conventions confirmed across all 48+ agents:
> use `tools:` (not `allowed-tools:`), single-line quoted `description:`,
> `model: inherit` (or `sonnet`). When `skills:` preloading is present, do NOT
> include `Skill` in `tools:` (redundant — per MEMORY.md). Both agents should
> preload `mempalace-conventions` via `skills:`. Frontmatter field order:
> `name`, `description`, `model`, `color` (optional), `skills`, `tools`.
> Note: skill frontmatter uses `user-invokable` (with k), NOT `user-invocable`.
<!-- /deepen-plan -->

### Phase 5: Skills & CLAUDE.md

- [ ] 5.1: Write `skills/mempalace-conventions/SKILL.md` (frontmatter: `user-invokable: false`)
  - MCP tool naming: `mcp__plugin_yellow-mempalace_mempalace__*`
  - Palace structure terminology (wings, rooms, halls, tunnels, closets,
    drawers)
  - Memory types: hall_facts, hall_events, hall_discoveries, hall_preferences,
    hall_advice
  - Search filter patterns (wing → room → hall narrowing)
  - KG triple format and temporal validity
  - Error handling catalog
  - Graceful degradation patterns

- [ ] 5.2: Write `skills/palace-protocol/SKILL.md` (frontmatter: `user-invokable: false`)
  - The Palace Protocol: call `status` first, query before asserting, verify
    facts, record learnings
  - AAAK dialect reference (for diary entries, optional)
  - L0-L3 memory stack usage guidance
  - When to use search vs KG vs navigation

- [ ] 5.3: Write `CLAUDE.md`
  - Plugin overview, MCP server details, conventions
  - Components table (commands, agents, skills)
  - When to use what (search vs KG vs navigate vs mine)
  - Cross-plugin notes: complements ruvector (real-time) with long-term memory
  - Known limitations
  - Maintenance (install/upgrade/uninstall)

- [ ] 5.4: Write `README.md`
  - User-facing quickstart: install, init, mine, search
  - Prerequisites (Python 3.9+)
  - Available commands
  - MCP tools list

### Phase 6: Registration & Validation

- [ ] 6.1: Register in `.claude-plugin/marketplace.json`
  - Add entry: name, description, version 1.0.0, category "development",
    source "./plugins/yellow-mempalace"

<!-- deepen-plan: codebase -->
> **Codebase:** Changed category from `"productivity"` to `"development"`.
> The analogous plugin `yellow-ruvector` (persistent agent memory) uses
> `"development"`. The `"productivity"` category is used by workflow tools
> (yellow-linear, yellow-chatprd, yellow-research). A memory/knowledge-graph
> plugin fits `"development"` better. Source path must use `./` prefix —
> all existing entries use `"./plugins/<name>"` format.
<!-- /deepen-plan -->

- [ ] 6.2: Run validation
  ```bash
  pnpm validate:schemas
  node scripts/validate-agent-authoring.js
  ```

- [ ] 6.3: Create changeset
  ```bash
  pnpm changeset  # select yellow-mempalace, minor bump
  ```

## Technical Details

### Files to Create

| File | Purpose |
|------|---------|
| `plugins/yellow-mempalace/.claude-plugin/plugin.json` | MCP server config |
| `plugins/yellow-mempalace/package.json` | Version sync |
| `plugins/yellow-mempalace/CLAUDE.md` | Plugin context |
| `plugins/yellow-mempalace/README.md` | User docs |
| `plugins/yellow-mempalace/scripts/install-mempalace.sh` | pipx/pip installer |
| `plugins/yellow-mempalace/commands/mempalace/setup.md` | Setup wizard |
| `plugins/yellow-mempalace/commands/mempalace/status.md` | Palace overview |
| `plugins/yellow-mempalace/commands/mempalace/search.md` | Semantic search |
| `plugins/yellow-mempalace/commands/mempalace/mine.md` | Content mining |
| `plugins/yellow-mempalace/commands/mempalace/kg.md` | Knowledge graph |
| `plugins/yellow-mempalace/commands/mempalace/navigate.md` | Palace browsing |
| `plugins/yellow-mempalace/agents/mempalace/palace-navigator.md` | Browse agent |
| `plugins/yellow-mempalace/agents/mempalace/memory-archivist.md` | Filing agent |
| `plugins/yellow-mempalace/skills/mempalace-conventions/SKILL.md` | Conventions |
| `plugins/yellow-mempalace/skills/palace-protocol/SKILL.md` | Protocol guide |

### Files to Modify

| File | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | Add yellow-mempalace entry |

### Dependencies

- `mempalace` (Python, pip/pipx) — the upstream CLI + MCP server
- Python 3.9+ — runtime requirement
- ChromaDB — installed as mempalace dependency (not standalone)

### MCP Tools Available (19)

**Read:** `status`, `list_wings`, `list_rooms`, `get_taxonomy`, `get_aaak_spec`
**Search:** `search`, `search_wing`, `search_hall`, `search_room`, `check_duplicate`
**KG:** `kg_query`, `kg_add`, `kg_invalidate`, `kg_timeline`, `kg_stats`
**Graph:** `traverse`, `find_tunnels`, `graph_stats`
**Write:** `add_drawer`, `delete_drawer`
**Diary:** `diary_write`, `diary_read`

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-mempalace included
2. `node scripts/validate-agent-authoring.js` passes for all agents
3. `/mempalace:setup` installs mempalace CLI and verifies MCP connection
4. `/mempalace:search "query"` returns results from an initialized palace
5. `/mempalace:status` shows palace overview
6. `/mempalace:mine path` mines content into the palace
7. `/mempalace:kg query entity` queries the knowledge graph
8. `/mempalace:navigate` browses palace structure
9. Both agents trigger on appropriate natural language
10. Plugin appears in marketplace (`/plugin marketplace list`)

## Edge Cases

- **No Python installed**: setup.md detects and reports with install guidance
- **PEP 668 environment**: install script detects and suggests pipx
- **No palace initialized**: commands check and offer `mempalace init`
- **ChromaDB cold start**: first MCP call may take 2-5s — document in CLAUDE.md
- **Empty palace**: search/navigate commands handle gracefully with guidance
- **mempalace not in PATH**: install script checks ~/.local/bin and warns

## Security Considerations

- **Shell injection (#110)**: Hooks deferred to Phase 2 (future PR) pending
  upstream fix. All Phase 1 integration is MCP-only (no shell execution).
- **SESSION_ID injection**: Upstream hooks use SESSION_ID from untrusted JSON
  unsanitized in file paths — additional reason to defer hooks.
- **No tokens/credentials**: mempalace is fully local, no API keys needed
- **Input validation**: All user-provided search queries sanitized before MCP
  calls (strip HTML, max 1000 chars per mempalace conventions)
- **Palace data**: `.mempalace/` should be gitignored (per-developer data)

<!-- deepen-plan: external -->
> **Research:** Two distinct security issues exist in mempalace hooks:
> (1) Shell injection in hooks (#110) — command arguments passed unsanitized
> to shell execution, (2) SESSION_ID from untrusted JSON used unsanitized in
> hook file paths — enables path traversal. Both are in the hook scripts only,
> not the MCP server. The plan's MCP-only approach in Phase 1 avoids both.
> When hooks are added in Phase 2, the install script should verify both fixes
> have shipped upstream before enabling hooks.
<!-- /deepen-plan -->

## Future Work (Not in Scope)

- **Hooks (Phase 2)**: Save hook (every 15 messages) + PreCompact hook. Blocked
  on mempalace #110 fix.
- **Cross-plugin bridge**: ruvector learnings → mempalace long-term storage.
  Requires both plugins installed.
- **Conversation export mining**: Mine Claude Code session exports into palace
  wings.
- **Team memory sharing**: Export/import palace subsets for team knowledge.

## References

- [Research doc](../docs/research/mempalace-memory-tool-vs-ruvector.md)
- [MemPalace repo](https://github.com/milla-jovovich/mempalace)
- [RuVector plugin](../plugins/yellow-ruvector/) — reference for conventions
- [Semgrep plugin](../plugins/yellow-semgrep/) — reference for Python CLI setup
- [Plugin structure docs](../docs/CLAUDE.md) — marketplace conventions

<!-- deepen-plan: external -->
> **Research:** Additional references from deep research:
> - [Penfield Labs critical analysis](https://penfieldlabs.substack.com/p/milla-jovovich-just-released-an-ai) — disputed benchmarks, AAAK lossiness, missing features
> - [lhl/agentic-memory independent analysis](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md) — technical verification of claims
> - [Dev.to technical walkthrough](https://dev.to/recca0120/mempalace-170-tokens-to-recall-everything-a-long-term-memory-system-for-ai-agents-2855) — Claude Code integration details
> - [PyPI: mempalace](https://pypi.org/project/mempalace/) — v3.0.0 package listing
> - [GitHub Issue #27](https://github.com/milla-jovovich/mempalace/issues/27) — AAAK lossiness documentation
> - [GitHub Issue #29](https://github.com/milla-jovovich/mempalace/issues/29) — benchmark methodology concerns
<!-- /deepen-plan -->
