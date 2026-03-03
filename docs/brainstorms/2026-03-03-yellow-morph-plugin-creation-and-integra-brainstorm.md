# Brainstorm: yellow-morph Plugin Creation and Integration Strategy

**Date:** 2026-03-03
**Status:** Ready for planning
**Research source:** docs/research/morph-llm-warpgrep-v3-claude-code-plugins.md

## What We're Building

A new `yellow-morph` plugin that brings Morph-LLM's Fast Apply (code editing)
and WarpGrep (intent-based code search) into the yellow-plugins ecosystem as
passive acceleration tools. The plugin configures Morph's official MCP server
and provides CLAUDE.md guidance so Claude automatically prefers morph tools when
they are the right fit. Four existing plugins (core, review, debt, ci) receive
lightweight hints pointing to morph's benefits for their specific workflows.

### Core Capabilities Introduced

| Tool | What It Does | When Claude Uses It |
|------|-------------|---------------------|
| `edit_file` (Fast Apply) | Deterministic, structure-aware code merging at 10,500+ tok/s, 98%+ accuracy | Preferred over built-in Edit for multi-line code changes, especially in files >200 lines |
| `warpgrep_codebase_search` (WarpGrep) | RL-trained agentic search subagent, 0.73 F1 in 3.8 steps, no indexing required | Intent-based discovery queries ("find where billing handles failures") in unfamiliar code |

### What This Is NOT

- Not a replacement for ruvector (different domain -- see Domain Separation below)
- Not a set of explicit commands in v1 (no /morph:search, /morph:edit)
- Not an SDK integration (MCP-only in v1 -- see v2 Considerations)

## Why This Approach

### Design Decisions (Q&A Summary)

**Q1: Integration depth?**
Decision: **Passive acceleration + lightweight cross-plugin hints.** Morph's MCP
tools are designed to be auto-preferred by Claude when available. Wrapping them
in explicit commands would be redundant ceremony. Instead, CLAUDE.md hints teach
Claude when to reach for morph tools vs. built-in alternatives.

**Q2: WarpGrep vs ruvector overlap?**
Decision: **Domain separation.** WarpGrep and ruvector serve different purposes
and should never compete on the same query. Hints enforce clear lanes:
- WarpGrep = "find code I haven't seen" (intent-based discovery, stateless)
- ruvector = "recall something I learned before" (persistent memory, indexed)

**Q3: SDK or MCP-only?**
Decision: **MCP-only for v1.** The official `@morphllm/morphmcp` package runs
as a separate process with zero license risk (yellow-plugins is MIT; the SDK
is reported as AGPLv3). SDK value-add (programmatic chaining, custom
timeout/retry, morph.git operations) is deferred to v2 pending license
verification.

**Q4: Which plugins get cross-plugin hints?**
Decision: **All four high-value plugins.** Core (domain separation + tool
preference), review (WarpGrep for blast radius / caller discovery), debt
(WarpGrep for anti-pattern search + Fast Apply for remediation), ci (Fast Apply
for fix application). The cost of hints is negligible (2-3 lines each); even
moderate benefit in ci justifies inclusion.

### Chosen Approach: Hybrid (Approach C)

**Thin Plugin + Central CLAUDE.md + Lightweight Distributed Hints**

yellow-morph's CLAUDE.md is the single source of truth for all morph usage
guidance: domain separation rules, tool preference hierarchy, and detailed
usage documentation. The four target plugins each get a minimal "Optional
Enhancement" section (2-3 lines) that describes the specific benefit morph
provides for that plugin's workflow. This follows the ruvector "Workflow
Integration" precedent.

**Why this over alternatives:**

- **vs. Distributed Hints only (Approach A):** Approach A scatters guidance
  across 4 files with no central source of truth. When morph capabilities
  change, all 4 files need updating. Approach C keeps the detail in one place.
- **vs. Central Skill (Approach B):** Skills require explicit loading (in agent
  definitions or commands), adding latency and requiring references in every
  agent that might benefit. CLAUDE.md is always loaded for installed plugins --
  zero latency, zero ceremony.

### Codebase Patterns Informing This Design

1. **Cross-plugin dependency sections** are standard: `## Cross-Plugin
   Dependencies` with `- **plugin-name** -- Required for X. Without it, Y.`
   Used by yellow-debt, yellow-ci, yellow-review, yellow-linear, yellow-chatprd.

2. **Workflow Integration sections** (ruvector precedent): Numbered steps
   describing behavior that activates "when yellow-ruvector is installed."
   This is the closest match for morph's passive acceleration pattern.

3. **MCP server config patterns**: Stdio transport
   (`{ "command": "npx", "args": [...], "env": {...} }`) used by ruvector.
   Morph follows this same pattern.

4. **Tool naming convention**: `mcp__plugin_{pluginName}_{serverName}__{toolName}`.
   Morph tools resolve to:
   - `mcp__plugin_yellow-morph_morph-mcp__edit_file`
   - `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search`

5. **No existing "tool preference" pattern**: No plugin currently says "prefer
   this MCP tool over built-in X." This is new territory. Morph's own docs say
   Claude auto-prefers `edit_file` when available, but explicit CLAUDE.md
   guidance ensures correct routing for search (WarpGrep vs Grep vs ruvector).

## Key Decisions

### 1. Plugin Structure

```
plugins/yellow-morph/
  .claude-plugin/
    plugin.json            # MCP server config for @morphllm/morphmcp
  commands/
    morph/
      setup.md             # /morph:setup -- prerequisites, API key, MCP install, verify
  CLAUDE.md                # Source of truth: domain separation, tool preference, usage
  README.md                # User-facing docs
  CHANGELOG.md
  package.json
```

No agents, skills, or hooks in v1. The plugin is configuration + documentation.

### 2. plugin.json Configuration

```json
{
  "name": "yellow-morph",
  "version": "1.0.0",
  "description": "Intelligent code editing and search via Morph Fast Apply and WarpGrep",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/KingInYellows"
  },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-morph",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["code-editing", "code-search", "fast-apply", "warpgrep"],
  "mcpServers": {
    "morph-mcp": {
      "command": "npx",
      "args": ["@morphllm/morphmcp"],
      "env": {
        "MORPH_API_KEY": "${MORPH_API_KEY}",
        "ENABLED_TOOLS": "edit_file,warpgrep_codebase_search",
        "WORKSPACE_MODE": "true"
      }
    }
  }
}
```

### 3. Domain Separation: WarpGrep vs ruvector

This is the most important guidance in yellow-morph's CLAUDE.md. It prevents
the two search tools from competing on the same query.

| Dimension | WarpGrep (`warpgrep_codebase_search`) | ruvector (`hooks_recall`, `hooks_route`) |
|-----------|---------------------------------------|------------------------------------------|
| **Domain** | "Find code I haven't seen" | "Recall something I learned before" |
| **Search type** | Intent-based discovery | Similarity-based memory retrieval |
| **Indexing** | None required (works instantly) | Requires one-time index step |
| **Persistence** | Stateless -- no memory across queries | Persistent -- learns across sessions |
| **Best for** | "Where does billing handle failures?" | "What pattern did I use for error handling last time?" |
| **Speed** | 3-6 seconds per search | Sub-100ms after indexing |
| **When to use** | Exploring unfamiliar code, finding callers, blast radius, intent queries | Recalling past learnings, finding similar patterns, session memory |

**Routing rule for CLAUDE.md:**
- If the query is about *discovering* code the user/agent has not seen before,
  use `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search`.
- If the query is about *recalling* a past learning, pattern, or similar code
  from indexed memory, use ruvector tools.
- If ruvector is not installed, WarpGrep handles all code search.
- If yellow-morph is not installed, ruvector and built-in Grep handle all
  search (existing behavior, no degradation).

### 4. Tool Preference Guidance

**Fast Apply (`edit_file`) vs built-in Edit tool:**
- Prefer `mcp__plugin_yellow-morph_morph-mcp__edit_file` for multi-line code
  changes, especially in files longer than 200 lines.
- Continue using built-in Edit for small, precise, single-line replacements
  where the exact old_string is known and unique.
- Fast Apply accepts "lazy edit snippets" with `// ... existing code ...`
  markers -- the AI specifies what changes, morph handles the merge.
- Fast Apply scales to 1,500-line files at 99.2% accuracy (built-in
  search-and-replace degrades above 200 lines).

**WarpGrep (`warpgrep_codebase_search`) vs built-in Grep:**
- Prefer `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search` for
  intent-based queries ("how does authentication work?", "find error handling
  for payment failures").
- Continue using built-in Grep for exact pattern matching (regex, literal
  strings, known function names).
- WarpGrep runs as a separate subagent in an isolated context window --
  it does not pollute the main model's context.
- WarpGrep issues up to 8 parallel grep operations per turn and completes
  in 3.8 steps average (sub-6 seconds).

### 5. Cross-Plugin Hints

Each target plugin's CLAUDE.md gets a minimal "Optional Enhancement" section.
These follow the existing "Cross-Plugin Dependencies" pattern but describe
*enhancements* rather than requirements.

**yellow-core CLAUDE.md addition:**

```markdown
### Optional Enhancement: yellow-morph

When yellow-morph is installed, two additional tools become available:
`edit_file` (Fast Apply for high-accuracy code merging) and
`warpgrep_codebase_search` (intent-based code discovery). See yellow-morph's
CLAUDE.md for tool preference rules and domain separation with ruvector.
```

**yellow-review CLAUDE.md addition:**

```markdown
### Optional Enhancement: yellow-morph

When yellow-morph is installed, review agents can use
`warpgrep_codebase_search` to find related code across the codebase (callers,
similar patterns, blast radius) when reviewing changes. This is preferred over
Grep for intent-based queries like "what else calls this function?"
```

**yellow-debt CLAUDE.md addition:**

```markdown
### Optional Enhancement: yellow-morph

When yellow-morph is installed, scanners can use `warpgrep_codebase_search`
to find anti-pattern instances by intent, and the debt-fixer agent can use
`edit_file` for higher-accuracy code remediation on large files.
```

**yellow-ci CLAUDE.md addition:**

```markdown
### Optional Enhancement: yellow-morph

When yellow-morph is installed, `edit_file` is preferred for applying code
fixes to resolve CI failures, especially in files longer than 200 lines where
built-in edit accuracy degrades.
```

### 6. /morph:setup Command

The single command in v1. Responsibilities:

1. **Check prerequisites:** `rg` (ripgrep) installed, Node.js 18+, network
   egress to morphllm.com
2. **API key configuration:** Prompt for MORPH_API_KEY, validate with a test
   API call, suggest adding to shell profile
3. **MCP server verification:** Confirm `@morphllm/morphmcp` is accessible
   via npx, verify tool registration
4. **Health check:** Run a test WarpGrep search and Fast Apply operation to
   confirm end-to-end functionality
5. **Credit balance:** Display current tier and remaining credits

### 7. yellow-morph CLAUDE.md (Source of Truth)

The CLAUDE.md should contain these sections:

```
# yellow-morph Plugin

Intelligent code editing and search via Morph Fast Apply and WarpGrep.

## MCP Server
- morph-mcp -- Stdio transport via `npx @morphllm/morphmcp`
- Requires MORPH_API_KEY environment variable
- Tools: edit_file, warpgrep_codebase_search

## Tool Preference Rules
[Full edit_file vs Edit and warpgrep vs Grep guidance from Key Decision 4]

## Domain Separation: WarpGrep vs ruvector
[Full domain separation table and routing rules from Key Decision 3]

## Plugin Components
### Commands (1)
- /morph:setup -- Prerequisites, API key, MCP install, verify

## Prerequisites
- ripgrep (rg) installed
- Node.js 18+
- MORPH_API_KEY environment variable
- Network egress to morphllm.com (port 443)

## Known Limitations
- WarpGrep requires network egress (code context sent to Morph API)
- Free tier: 250K credits, 200 requests/month
- WarpGrep timeout: 30s default (configurable via MORPH_WARP_GREP_TIMEOUT)
- No offline mode -- both tools require API connectivity
- edit_file is not suitable for non-code files (configs, markdown)
```

## Open Questions

1. **Data privacy posture:** Morph's free tier retains data for 90 days.
   Enterprise offers ZDR (zero data retention) mode. Should the setup command
   warn users about data retention on free/starter tiers? Should this be a
   blocking warning or informational?

2. **Auto-preference vs explicit routing:** Morph's docs say Claude
   "automatically prefers edit_file over search-and-replace" when the MCP
   server is configured. Should we rely on this automatic preference, or
   should CLAUDE.md explicitly state preference rules? (Current decision:
   explicit rules in CLAUDE.md for clarity, but this may create conflict
   with auto-preference behavior.)

3. **WarpGrep timeout tuning:** Default is 30s. For large monorepos this
   may be too short; for small repos it wastes budget if the search is
   stuck. Should /morph:setup offer timeout configuration, or hardcode 30s?

4. **Credit usage visibility:** Should there be a hook (e.g., SessionStart
   or Stop) that checks remaining credits and warns if low? Or is this
   over-engineering for v1?

5. **Testing strategy:** How to test a plugin that wraps an external paid
   API? Options: mock MCP server for unit tests, integration tests with
   free tier, or skip automated testing and rely on manual /morph:setup
   verification.

6. **ruvector not installed scenario:** When yellow-morph is installed but
   ruvector is NOT, WarpGrep handles all code search. The domain separation
   rules become irrelevant. Should CLAUDE.md handle this explicitly, or is
   it obvious enough?

7. **Morph model selection:** Morph offers morph-v3-fast (16K context,
   cheaper) and morph-v3-large (32K context, more accurate). The MCP server
   auto-routes. Should we expose model selection as configuration, or let
   auto-routing handle it?

### v2 Considerations

These items are explicitly deferred from v1:

1. **SDK integration:** The `@morphllm/morphsdk` npm package enables
   programmatic chaining (WarpGrep search piped into Fast Apply edits),
   custom timeout/retry logic, and direct access to `morph.git.*`
   operations. Main blocker: the SDK is reported as AGPLv3, which has
   copyleft implications for the MIT-licensed yellow-plugins repo.
   **Action:** Verify actual license on npm. If Apache-2.0 or MIT, include
   in v2. If AGPLv3, evaluate whether the separate-process exception
   applies or if we need a license waiver.

2. **Custom agents:** A `morph-edit` agent that chains WarpGrep discovery
   into Fast Apply multi-file edits. A `morph-search` agent for structured
   search output. These require SDK or complex MCP tool orchestration.

3. **Morph Embedding and Reranker:** Morph offers 768-dim code-specific
   embeddings (`morph-embedding-v3`) and a code-focused reranker. These
   could complement or replace ruvector's all-MiniLM-L6-v2 embeddings for
   higher-quality similarity search. Evaluate overlap with ruvector roadmap.

4. **Hooks for credit monitoring:** SessionStart hook to check credit
   balance, Stop hook to log session credit usage.

5. **Deeper cross-plugin integration:** Modify review agent definitions to
   include morph MCP tools in their `allowed-tools` frontmatter. Modify
   debt-fixer agent to explicitly prefer `edit_file`. These go beyond
   CLAUDE.md hints into agent-level changes.

6. **MorphGit operations:** The SDK exposes `morph.git.*` (init, clone,
   stage, commit, push, pull, branch). Evaluate whether these offer value
   over built-in Bash git commands.

## Next Steps

1. Run `/workflows:plan` on this brainstorm to generate an implementation
   plan with file-level tasks
2. Create the yellow-morph plugin directory structure
3. Write plugin.json with MCP server configuration
4. Write CLAUDE.md with tool preference and domain separation guidance
5. Write /morph:setup command
6. Add "Optional Enhancement" sections to yellow-core, yellow-review,
   yellow-debt, and yellow-ci CLAUDE.md files
7. Write README.md with user-facing documentation
8. Test with free tier MORPH_API_KEY
9. Validate with `pnpm validate:schemas`
