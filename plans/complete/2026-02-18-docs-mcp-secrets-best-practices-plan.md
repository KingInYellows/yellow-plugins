---
title: Document MCP server secrets and API key best practices for plugins
type: docs
date: 2026-02-18
---

# Document MCP Server Secrets & API Key Best Practices

## Overview

The yellow-plugins marketplace has no unified documentation for how plugin
consumers should configure secrets/API keys for MCP servers, nor standardized
guidance for plugin authors on handling credentials. This plan addresses both
gaps.

## Current State Analysis

### Auth patterns across plugins (3 categories)

| Category                      | Plugins                          | How it works                                                      | User action needed             |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| **No auth**                   | context7, deepwiki, ruvector     | Public HTTP endpoints or local stdio                              | None                           |
| **OAuth (Claude Code native)**| linear, chatprd                  | Browser popup on first MCP tool call, token managed by Claude Code| Run `/mcp` → authenticate      |
| **Shell env var**             | yellow-devin (REST API commands) | `DEVIN_API_TOKEN` read from shell environment via `$DEVIN_API_TOKEN` in curl commands | Set `DEVIN_API_TOKEN` in your shell profile |

### What Claude Code supports natively

1. **`env` field in plugin.json mcpServers** — passes env vars to stdio servers
   (yellow-ruvector uses this for `RUVECTOR_STORAGE_PATH`)
2. **`${VAR}` expansion in `.mcp.json`** — expands user's shell env vars in
   `command`, `args`, `env`, `url`, `headers` fields
3. **`${VAR:-default}` fallback syntax** — use default when var unset
4. **OAuth 2.0 flow** — HTTP MCP servers can use OAuth; Claude Code handles
   token storage in system keychain via `/mcp` command
5. **`--header` flag** — for Bearer tokens when adding servers via CLI
6. **`--env` flag** — for setting env vars when adding servers via CLI

### What's missing

- **No consumer-facing setup guide** explaining "after installing plugin X, do
  Y to configure secrets"
- **No plugin authoring guidance** for declaring required env vars or handling
  credentials
- **No `.env` convention** — `.gitignore` has `.env` entries but no documented
  pattern for plugin consumers
- **No schema support** for declaring required environment variables in
  `plugin.json` (the `mcpServers` field is an unvalidated `object`)
- **`docs/security.md`** has the MCP inventory table but doesn't tell users
  _how_ to configure auth

## Proposed Solution

A documentation-only change (no code changes needed) split into 3 deliverables:

### Deliverable 1: Consumer setup guide in docs/security.md

Add a "Setting Up Authentication" section to the existing `docs/security.md`
after the MCP Servers Inventory table. Cover each auth pattern with
copy-pasteable instructions:

```markdown
## Setting Up Authentication

### OAuth servers (yellow-linear, yellow-chatprd)

These plugins use browser-based OAuth. On first use:

1. Claude Code opens a browser popup for login
2. Authenticate with your Linear/ChatPRD account
3. Token is stored securely in your system keychain
4. To re-authenticate or revoke: run `/mcp` → select server → "Clear authentication"

No API keys or `.env` files needed.

### API token servers (yellow-devin)

yellow-devin commands require a `DEVIN_API_TOKEN` environment variable:

\```text
Add `DEVIN_API_TOKEN` to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.)
using your personal API token value from the Devin account settings page.
\```

Never commit tokens to version control. The `.gitignore` already excludes
`.env` files.

### No-auth servers (yellow-core, yellow-ruvector, yellow-devin deepwiki)

These servers require no configuration. They work immediately after plugin
installation.
```

### Deliverable 2: Plugin authoring guidance in docs/plugin-validation-guide.md

Add a "Secrets & Environment Variables" section to the plugin authoring docs:

**Best practices for plugin authors:**

1. **Prefer OAuth over API keys** — Claude Code handles OAuth lifecycle
   (storage, refresh, revocation) natively for HTTP MCP servers. Users don't
   need to manage any files.

2. **For env-var-based auth** (stdio servers or REST API commands):
   - Document the required env var name in the plugin's `README.md` under
     "Prerequisites"
   - Add validation at command/agent entry points (check `$VAR` is set,
     validate format, show setup URL on failure)
   - Never echo/log token values in error messages
   - Use `env` field in `plugin.json` mcpServers for non-secret config
     (paths, feature flags)
   - Use `${VAR}` expansion in `.mcp.json` for secrets that come from the
     user's shell environment

3. **Never store secrets in plugin code** — no hardcoded tokens, no `.env`
   files committed to the repo

4. **Declare prerequisites clearly** — if a plugin needs a token, say so in
   the first 3 lines of the README and in the plugin description

5. **No `.env` file convention** — Claude Code plugins should NOT require
   users to create `.env` files. Instead:
   - For MCP servers: use OAuth or `${VAR}` expansion in `.mcp.json`
   - For shell commands: read from shell environment (`$VAR`)
   - This avoids the "which `.env` file?" confusion across projects

### Deliverable 3: Update individual plugin READMEs

Audit each plugin README to ensure auth prerequisites are clearly documented
in a consistent format:

- **yellow-linear**: Add note that OAuth popup appears on first use
- **yellow-chatprd**: Add note about Clerk OAuth + browser requirement
- **yellow-devin**: Already has `DEVIN_API_TOKEN` prerequisite — good
- **yellow-core**: Already says no credentials — good
- **yellow-ruvector**: Already local-only — good

## What We're NOT Doing

- **No `.env` file convention** — Claude Code's `${VAR}` expansion and OAuth
  cover all current use cases without `.env` files
- **No plugin.json schema changes** — declaring required env vars in the schema
  would be nice but is premature (only 1 plugin needs env vars currently)
- **No secrets management tooling** — no vault integration, no encrypted config
  files. Shell env vars and OAuth are sufficient for the current plugin set
- **No code changes** — this is purely documentation

## Acceptance Criteria

- [x] `docs/security.md` has "Setting Up Authentication" section with
      instructions for all 3 auth categories
- [x] `docs/plugin-validation-guide.md` has "Secrets & Environment Variables"
      section with authoring guidance
- [x] Plugin READMEs for yellow-linear and yellow-chatprd mention OAuth flow
- [x] No `.env.example` files added (intentional — see rationale above)

## References

- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — env var
  expansion, OAuth flow, plugin MCP servers
- `docs/security.md:1-163` — current MCP inventory and trust boundaries
- `plugins/yellow-devin/skills/devin-workflows/SKILL.md:28-50` — token
  validation pattern
- `plugins/yellow-ruvector/.claude-plugin/plugin.json:16-24` — env field
  example for non-secret config
