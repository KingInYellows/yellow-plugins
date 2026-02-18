---
title: 'ruvector CLI commands and MCP tool names were fictitious'
category: integration-issues
date: 2026-02-18
tags:
  - ruvector
  - mcp
  - cli
  - plugin-authoring
  - yellow-ruvector
problem_type: api-mismatch
components:
  - plugins/yellow-ruvector/commands/ruvector/setup.md
  - plugins/yellow-ruvector/.claude-plugin/plugin.json
  - plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md
  - plugins/yellow-ruvector/agents/ruvector/semantic-search.md
  - plugins/yellow-ruvector/agents/ruvector/memory-manager.md
severity:
  critical: 3
  important: 0
  nice_to_have: 0
  total: 3
pr: direct-to-main
---

# ruvector CLI commands and MCP tool names were fictitious

## Problem Symptom

Running `/ruvector:setup` on a fresh machine produced a cascade of errors as the
command tried non-existent CLI subcommands:

```
$ npx ruvector init
error: unknown command 'init'
(Did you mean info?)

$ npx ruvector mcp-server
error: unknown command 'mcp-server'

$ npx ruvector create .ruvector/code -d 384 -m cosine
Failed to create database
Missing field `dimensions`
```

The MCP server also failed to start because plugin.json configured the args as
`["ruvector", "mcp-server"]` — a command that does not exist.

## Root Cause

The plugin was authored with assumed/invented CLI commands and MCP tool names
that were never verified against the actual ruvector binary. This is a common
pattern when LLM-generated code references tools it has training data about but
hasn't validated empirically.

**Three categories of errors:**

### 1. CLI commands that don't exist

| Assumed command | Actual command | Notes |
|---|---|---|
| `ruvector init` | `ruvector hooks init` | Subcommand under `hooks` |
| `ruvector mcp-server` | `ruvector mcp start` | Subcommand under `mcp` |
| `ruvector server` | `ruvector server` | Exists but is HTTP/gRPC, not MCP stdio |

### 2. MCP tool names that don't exist

The plugin referenced `vector_db_*` tools throughout all commands, agents, and
the conventions skill. The actual MCP tools (from `npx ruvector mcp info`) are:

| Assumed tool | Actual tool | Category |
|---|---|---|
| `vector_db_search` | `hooks_recall` | High-level memory search |
| `vector_db_insert` | `hooks_remember` | High-level memory storage |
| `vector_db_create` | `rvf_create` | Low-level vector store |
| `vector_db_stats` | `hooks_stats` | Intelligence statistics |
| — | `hooks_pretrain` | Built-in bulk repo indexing |
| — | `rvf_ingest` | Low-level vector insertion |
| — | `rvf_query` | Low-level nearest neighbor |

### 3. plugin.json MCP server config

```json
// WRONG — command does not exist
"args": ["ruvector", "mcp-server"]

// CORRECT — verified subcommand
"args": ["ruvector", "mcp", "start"]
```

## Investigation Steps

1. **Ran `/ruvector:setup` on a fresh project** — observed the `init` command
   failure, then `mcp-server` failure, then `create` failure
2. **Ran `npx ruvector --help`** — discovered the actual command tree with 20+
   subcommands including `hooks`, `mcp`, `embed`, `create`, etc.
3. **Ran `npx ruvector mcp info`** — discovered all actual MCP tool names are
   `hooks_*` and `rvf_*`, not `vector_db_*`
4. **Ran `npx ruvector hooks init --help`** — found the correct init command
   with flags like `--minimal`, `--no-claude-md`, `--no-mcp`, etc.
5. **Tested `npx ruvector hooks init --minimal --no-claude-md --no-permissions --no-env --no-mcp --no-statusline`** — confirmed it creates `.ruvector/` correctly
6. **Grepped for `vector_db_` and `mcp-server`** across the entire plugin — found
   references in 12 files

## Working Solution

### Fix 1: Setup command — use correct CLI commands

```markdown
# Before (wrong)
npx ruvector init
timeout 5 npx ruvector mcp-server </dev/null 2>&1 || true

# After (correct)
npx ruvector hooks init --minimal --no-claude-md --no-permissions --no-env --no-mcp --no-statusline
npx ruvector doctor 2>&1
npx ruvector hooks verify 2>&1
```

The `--no-*` flags prevent `hooks init` from creating configs that conflict with
what the plugin already manages (CLAUDE.md, MCP server config, hooks, etc.).

### Fix 2: plugin.json MCP server args

```diff
 "mcpServers": {
   "ruvector": {
     "command": "npx",
-    "args": ["ruvector", "mcp-server"],
+    "args": ["ruvector", "mcp", "start"],
     "env": {
       "RUVECTOR_STORAGE_PATH": "${PWD}/.ruvector/"
     }
   }
 }
```

### Fix 3: MCP tool names across all commands and agents

Updated `allowed-tools` frontmatter and inline references in all 6 commands, 2
agents, and the conventions skill:

```yaml
# Before (wrong)
allowed-tools:
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_search
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_insert

# After (correct)
allowed-tools:
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
```

### Fix 4: Index command — use built-in pretrain

The index command previously tried to manually chunk files and insert via
`vector_db_insert`. ruvector has a built-in `hooks_pretrain` MCP tool that
handles bulk repo indexing automatically.

## Files Changed (12 total)

- `plugins/yellow-ruvector/.claude-plugin/plugin.json` — MCP args
- `plugins/yellow-ruvector/CLAUDE.md` — CLI and tool name references
- `plugins/yellow-ruvector/commands/ruvector/setup.md` — Complete rewrite
- `plugins/yellow-ruvector/commands/ruvector/index.md` — Tool names + pretrain
- `plugins/yellow-ruvector/commands/ruvector/search.md` — Tool names
- `plugins/yellow-ruvector/commands/ruvector/learn.md` — Tool names
- `plugins/yellow-ruvector/commands/ruvector/memory.md` — Tool names
- `plugins/yellow-ruvector/commands/ruvector/status.md` — Tool names + CLI
- `plugins/yellow-ruvector/agents/ruvector/semantic-search.md` — Tool names
- `plugins/yellow-ruvector/agents/ruvector/memory-manager.md` — Tool names
- `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md` — Tool catalog
- `docs/security.md` — CLI command reference

## Prevention Strategies

### 1. Always verify CLI commands empirically

Before referencing any CLI tool in a plugin command:

```bash
npx <tool> --help          # Top-level commands
npx <tool> <cmd> --help    # Subcommand details
npx <tool> <cmd> info      # Self-documentation
```

Never assume command names from training data or documentation that may be
outdated.

### 2. Verify MCP tool names from the server itself

```bash
npx ruvector mcp info      # Lists all actual MCP tool names
```

MCP tool names in `allowed-tools` must match exactly — Claude Code won't
discover tools with wrong names.

### 3. Test setup commands on a fresh project

```bash
cd /tmp && mkdir test-project && cd test-project && git init
# Run the setup command and verify each step
```

### 4. Add a CLI verification step to plugin validation

The repo's `pnpm validate:schemas` pipeline validates JSON structure but not CLI
command correctness. Consider adding a smoke test that verifies referenced CLI
commands exist (at least `--help` succeeds).

### 5. Document verified CLI reference in commands

The updated setup command now includes a "CLI Reference" section that explicitly
lists verified commands and warns about non-existent ones. Other plugin commands
should follow this pattern when wrapping external CLIs.

## Related Documentation

- [Plugin manifest validation errors](../build-errors/claude-code-plugin-manifest-validation-errors.md) — Related plugin.json schema issues from same session
- [Skill frontmatter requirements](../code-quality/skill-frontmatter-attribute-and-format-requirements.md) — Another case of assumed-vs-actual format mismatch
- `plugins/yellow-ruvector/CLAUDE.md` — Updated plugin conventions
