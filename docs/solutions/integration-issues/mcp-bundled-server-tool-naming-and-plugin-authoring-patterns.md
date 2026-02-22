---
title: 'MCP bundled server tool naming and plugin authoring patterns from yellow-research'
category: integration-issues
date: 2026-02-21
tags:
  - mcp
  - plugin-authoring
  - tool-naming
  - yellow-research
  - allowed-tools
  - slug-sanitization
symptom: >
  Agents and commands reference wrong MCP tool names for bundled servers; tool calls fail
  at runtime. Compounded when the same MCP package is also available as a standalone global
  plugin, making the wrong names "look right" from memory.
root_cause: >
  Plugin authors copy tool names from memory or LLM training data instead of deriving them
  from the plugin manifest. A bundled MCP server's tool prefix is always
  mcp__plugin_{pluginName}_{serverName}__, NOT the server package's own plugin name.
component: yellow-research
affected_files:
  - plugins/yellow-research/.claude-plugin/plugin.json
  - plugins/yellow-research/agents/research/research-conductor.md
  - plugins/yellow-research/agents/research/code-researcher.md
  - plugins/yellow-research/commands/research/code.md
  - plugins/yellow-research/commands/research/deep.md
related_solutions:
  - docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md
  - docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md
---

# MCP Bundled Server Tool Naming and Plugin Authoring Patterns

Documented from the `yellow-research` plugin PR #33 review cycle. Four distinct
gotchas encountered, any of which would cause silent runtime failures.

## Symptom

- Agent/command `allowed-tools` list contains tool names that look plausible but fail
  at runtime ("tool not found")
- Tool names match a GLOBAL plugin's namespace instead of the bundling plugin's namespace
- Commands that claim to "delegate to an agent" never actually invoke the agent
- Slug-based file paths can be bypassed with crafted user input

## Root Cause Analysis

### Issue 1 (Critical): Wrong tool prefix for bundled MCP servers

**Mental model:** A Claude Code plugin that bundles an MCP server owns the tool namespace.
The tool prefix is derived from the **plugin manifest**, not the MCP package name.

```
mcp__plugin_{pluginName}_{serverName}__{toolName}
              ↑              ↑            ↑
         plugin.json    mcpServers    registered by
         "name" field     key         the MCP server
```

**Concrete example (yellow-research plugin):**
```json
// plugin.json
{
  "name": "yellow-research",
  "mcpServers": {
    "perplexity": { "command": "npx", "args": ["-y", "@perplexity-ai/mcp-server@0.8.2"] }
  }
}
```

Correct tool prefix: `mcp__plugin_yellow-research_perplexity__perplexity_ask`
Wrong prefix used: `mcp__plugin_perplexity_perplexity__perplexity_ask`

The wrong prefix references a SEPARATE globally-installed Perplexity plugin, not the
bundled server.

**Why it's easy to get wrong:** If Perplexity is also installed as a standalone plugin,
the global tool names (`mcp__plugin_perplexity_perplexity__*`) work in your local session.
LLM training data also reinforces the global names. The bundled prefix only materializes
correctly when you empirically run ToolSearch after plugin installation.

**Reference precedent** (compound-engineering plugin):
- Plugin name: `compound-engineering`
- Server key: `context7`
- Correct prefix: `mcp__plugin_compound-engineering_context7__resolve-library-id` ✅

### Issue 2: Command missing `Task` for agent delegation

A command that says "Delegate to the `code-researcher` agent" MUST have `Task` in its
`allowed-tools`. Without `Task`, Claude runs the command body inline and the agent file
is never invoked — it just silently becomes dead code.

```yaml
# Wrong — agent delegation will never happen
allowed-tools:
  - Read
  - mcp__plugin_yellow-research_exa__get_code_context_exa

# Correct
allowed-tools:
  - Task   # ← required for explicit agent invocation
  - Read
  - mcp__plugin_yellow-research_exa__get_code_context_exa
```

**Diagnostic:** If a command and its target agent have identical `allowed-tools` lists,
Task is probably missing — they've converged to the same implementation.

### Issue 3: `allowed-tools` in the wrong file

When a command delegates entirely to an agent, the agent's allowed-tools should contain
the MCP tools — not the command's. The command only needs tools it calls DIRECTLY.

```
/research:deep command: needs Task, Write, Bash, AskUserQuestion
research-conductor agent: needs all MCP tools (Perplexity, Tavily, EXA, Parallel Task)
```

If `create_task_group` is in the command's allowed-tools but only the agent ever calls
it, move it to the agent. Misplaced declarations cause tool-access errors.

### Issue 4: Slug sanitization as LLM instruction vs executed Bash

Command files show pseudocode to guide the LLM, but the LLM must actually execute Bash
to enforce constraints on user-input-derived paths.

**Wrong (pseudocode only):**
```markdown
Convert topic to slug: `[a-z0-9-]`, max 40 chars
```

**Right (Bash the LLM executes):**
```bash
SLUG=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-' | sed 's/^-//;s/-$//' | cut -c1-40)
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{0,39}$' || SLUG="research-$(date +%Y%m%d%H%M%S | cut -c1-14)"
TARGET="docs/research/${SLUG}.md"
N=2; while [ -f "$TARGET" ]; do TARGET="docs/research/${SLUG}-${N}.md"; N=$((N + 1)); done
```

This prevents path traversal (`../../.env` → cleaned to `env`), handles unicode,
and makes collision resolution deterministic.

## Working Solution

For each issue:

1. **Wrong tool prefix** → Derive prefix from plugin.json: `mcp__plugin_{name}_{serverKey}__`
   Verify with `ToolSearch "perplexity"` (or whatever server) after installation.

2. **Missing Task** → Any command that says "delegate to agent X" must have `Task` in
   allowed-tools.

3. **Misplaced allowed-tools** → Each file declares only the tools IT calls directly.
   The agent that runs the MCP tools owns those tool declarations.

4. **LLM-only slug** → Add an executable Bash block that sanitizes and validates the
   slug before using it in a file path.

## Prevention Checklist

When adding a new bundled MCP server to a plugin, run through this:

```
□ Derive tool prefix from plugin.json:
    pluginName  = plugin.json "name"
    serverName  = mcpServers key
    prefix      = mcp__plugin_{pluginName}_{serverName}__

□ After install, run: ToolSearch "{serverName}" → verify actual tool names
  (never trust LLM-generated names, even if they look familiar)

□ For each command that delegates to an agent:
    - Command allowed-tools: includes Task
    - Agent allowed-tools: includes the MCP tools it calls
    - No duplication between command and agent tool lists

□ For any path derived from user input (slugs, filenames):
    - Use Bash sanitization (tr, sed, grep -qE) not just instructions
    - Validate the result before using in Write/Bash paths

□ If an MCP package is also available as a standalone global plugin:
    - Don't copy tool names from the global plugin
    - The bundled copy gets the new prefix, they are independent namespaces
    - Two running instances = duplication; choose one and document it
```

## Red Flags

- Your `allowed-tools` contain `mcp__plugin_X_X__` where the first and second X are the
  same — that's a standalone plugin's self-reference, not a bundled server name
- Command and agent have identical `allowed-tools` lists (command is redundant layer)
- Tool name was generated from memory/training data and never verified with ToolSearch
- A Bash code block in a command file uses `<placeholder>` syntax — that's pseudocode,
  not executable code

## Context7 Optional Dependency Note

When an agent uses tools from another plugin (e.g., Context7 from compound-engineering),
always add a graceful fallback:

```markdown
**Start with Context7** for any named library — it has official, up-to-date docs.
Fall back to EXA if Context7 is unavailable (not installed) or doesn't have the library.
```

Document optional dependencies in README with `**Optional:**` heading so users know
what to install for full functionality.

## Related

- `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md` —
  Same "verify tool names empirically" lesson but for CLI commands vs MCP tool names
- Memory: "Plugin Authoring Quality Rules" — existing checklist for agent/command quality
- SKILL.md in `research-patterns` — MCP Tool Name Verification section (ToolSearch pattern)
