---
title: 'Cross-Plugin Documentation Correctness: Commands and Credentials'
date: 2026-02-25
category: 'code-quality'
---

# Cross-Plugin Documentation Correctness: Commands and Credentials

## Problem

Documentation that references multiple plugins frequently contains incorrect
command names and credential names because authors infer these from convention
(plugin name, ecosystem norms) rather than reading the actual source files.

Three classes of error observed in PR #75:

1. **Wrong command name:** `/linear:delegate` used instead of `/devin:delegate`
   — the correct command was in `yellow-devin`, not `yellow-linear`. The
   namespace prefix matches the plugin, not the subject matter.

2. **Wrong credential name:** `DEVIN_API_KEY` used instead of
   `DEVIN_SERVICE_USER_TOKEN`. The yellow-devin plugin uses a service user token
   with `cog_` prefix, not a generic API key. The variable name and format are
   unique and cannot be guessed.

3. **Wrong credential type:** `LINEAR_API_KEY` listed as a required env var when
   yellow-linear uses MCP OAuth — no env var is needed at all. MCP-based plugins
   authenticate through the MCP server, not through shell environment variables.

All three are P1 correctness bugs: users who follow incorrect documentation will
fail to set up the integration.

## Detection

When writing or reviewing documentation that references plugin commands or
credentials:

- Any command in the form `/plugin:verb` — read the command file's `name:`
  frontmatter field to confirm the exact string.
- Any environment variable name — read the plugin's `CLAUDE.md` "Required
  Environment Variables" section or `README.md` setup instructions.
- Any credential setup step — check whether the plugin uses direct shell env
  vars or MCP OAuth. MCP-based plugins (`mcpServers` in `plugin.json`) often
  have no env var requirement.

Detection grep for reviewing cross-plugin docs:

```bash
# Find all /command:verb references in a doc and verify each
grep -oE '/[a-z]+:[a-z]+' docs/guides/some-guide.md

# For each reference, verify the plugin's command frontmatter
grep -r '^name:' plugins/yellow-devin/commands/ plugins/yellow-linear/commands/

# Find all env var names mentioned in a doc
grep -oE '[A-Z][A-Z0-9_]{4,}' docs/guides/some-guide.md | grep -v '^[A-Z][A-Z]$'

# Compare against what the plugin actually declares
grep -r 'DEVIN_\|LINEAR_\|GITHUB_' plugins/yellow-devin/CLAUDE.md plugins/yellow-linear/CLAUDE.md
```

## Fix

### Command name errors

Read `name:` from the command's frontmatter file, not from the plugin directory
name or inferred convention:

```bash
# Correct: read the actual name field
head -5 plugins/yellow-devin/commands/devin/delegate.md
# name: devin:delegate  <-- use exactly this string
```

Command names follow `namespace:verb` where `namespace` comes from the plugin's
command directory name (e.g., `commands/devin/` → `devin:`), not the plugin
package name.

### Credential name errors

Read the plugin's `CLAUDE.md` "Required Environment Variables" section:

```bash
# yellow-devin
grep -A5 'Required Environment' plugins/yellow-devin/CLAUDE.md
# DEVIN_SERVICE_USER_TOKEN — Service user credential (cog_ prefix)
# DEVIN_ORG_ID — Organization ID

# yellow-linear
grep -A5 'Required Environment\|env var\|OAuth' plugins/yellow-linear/CLAUDE.md
# (no env vars — uses MCP OAuth)
```

### MCP OAuth vs env var

If a plugin's `plugin.json` has a `mcpServers` block, the plugin authenticates
through the MCP server. Check what credentials, if any, the MCP server itself
needs. In most cases no shell env var is needed for the plugin commands.

```bash
# Check whether plugin uses MCP servers
jq '.mcpServers // empty' plugins/yellow-linear/.claude-plugin/plugin.json
```

## False Positive Pattern: Review Agent Claims Command Does Not Exist

A review agent may flag a `/plugin:verb` reference as incorrect, claiming the
command does not exist — without reading the file system to verify. This is a
false positive if the command file is present.

Observed in PR #76: a review agent flagged `/linear:delegate` as non-existent.
The file `plugins/yellow-linear/commands/linear/delegate.md` exists and the
command is valid. The agent relied on its context-window knowledge rather than
verifying on disk.

**Rule:** When a review finding claims a command does not exist, the agent MUST
verify by reading the filesystem before accepting the finding:

```bash
# Verify the command file exists before accepting "command not found" findings
ls plugins/yellow-linear/commands/linear/delegate.md

# Or list all commands in a plugin namespace
ls plugins/yellow-linear/commands/linear/
```

Do not revert a correct command reference based on a review finding that was not
verified empirically.

## Prevention

When authoring any documentation that cross-references plugins:

1. **Grep before you write:** Run `grep -r '^name:' plugins/<target>/commands/`
   to get exact command names for every plugin you reference.
2. **Read CLAUDE.md first:** Open the target plugin's `CLAUDE.md` before writing
   setup instructions. The "Required Environment Variables" section is the
   authoritative source.
3. **Distinguish API token vs MCP OAuth:** Never assume a plugin needs an env
   var. Check `plugin.json` for `mcpServers`. If present, ask: does the MCP
   server authenticate via user-supplied env var, or via its own OAuth flow?
4. **Verify command namespace:** The command prefix (`/devin:`, `/linear:`) comes
   from the subdirectory under `commands/`, not the plugin name. `yellow-devin`
   plugin lives at `plugins/yellow-devin/commands/devin/` → prefix is `devin:`.
5. **Reject unverified "command not found" findings:** Before acting on a review
   agent's claim that a command reference is wrong, run `ls` or `Glob` to
   confirm the command file does not exist. If it does exist, the finding is a
   false positive — dismiss it.

### Plugin credential reference table (current as of 2026-02-25)

| Plugin | Command prefix | Auth mechanism | Env vars required |
|---|---|---|---|
| yellow-devin | `/devin:` | Direct API (curl) | `DEVIN_SERVICE_USER_TOKEN` (`cog_` prefix), `DEVIN_ORG_ID` |
| yellow-linear | `/linear:` | MCP OAuth | None (MCP handles auth) |
| yellow-core | `/core:` | git / gh CLI | None |
| gt-workflow | `/gt:` | Graphite CLI | None |
