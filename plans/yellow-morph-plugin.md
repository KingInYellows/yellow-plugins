# Feature: yellow-morph Plugin — Morph Fast Apply and WarpGrep Integration

## Overview

Create a new `yellow-morph` plugin that brings Morph-LLM's Fast Apply (code
editing) and WarpGrep (intent-based code search) into the yellow-plugins
ecosystem as passive acceleration tools. The plugin configures Morph's official
MCP server and provides CLAUDE.md guidance so Claude automatically prefers morph
tools when appropriate. Four existing plugins receive lightweight cross-plugin
hints.

## Problem Statement

### Current Pain Points

- Claude's built-in Edit tool uses search-and-replace which degrades above 200
  lines (~86% accuracy with Claude Sonnet 4)
- Code search via built-in Grep finds patterns, not intent. Cannot answer "how
  does billing handle failed payments?"
- Agents exploring unfamiliar codebases spend significant time on multi-step
  grep-based discovery

### User Impact

- Faster, more accurate code edits (98%+ accuracy at 10,500+ tok/s)
- Intent-based code discovery without indexing (0.73 F1 in 3.8 steps)
- These benefits apply to all freeform Claude Code usage and compound across
  review, debt, and CI workflows

## Proposed Solution

### High-Level Architecture

Thin plugin using Morph's official MCP server (`@morphllm/morphmcp`). No custom
code, agents, skills, or hooks in v1. The plugin is configuration + documentation
that teaches Claude when to use morph tools vs built-in alternatives.

<!-- deepen-plan: external -->
> **Research:** The `@morphllm/morphmcp` package is at version **0.8.110** on
> npm (MIT-licensed). It is an MCP stdio server, not a general CLI tool — it
> exposes a `bin` entry `morph-mcp` -> `dist/index.js`. The package has had 96+
> releases, all within the 0.8.x range, indicating rapid iteration. The MIT
> license on the MCP server package is confirmed (distinct from the SDK's
> reported AGPLv3). See: https://www.npmjs.com/package/@morphllm/morphmcp
<!-- /deepen-plan -->

### Key Design Decisions

1. **Passive acceleration** — MCP tools are auto-available; no explicit commands
   beyond `/morph:setup` and `/morph:status`
2. **Domain separation** with ruvector — WarpGrep = "find code I haven't seen";
   ruvector = "recall something I learned"
3. **MCP-only, permanently** — no SDK dependency (`@morphllm/morphsdk` is
   AGPLv3, incompatible with our MIT repo). The MCP server package is MIT and
   provides full functionality via MCP tools. SDK is ruled out.
4. **Hybrid hints** — morph CLAUDE.md is source of truth; 4 other plugins get
   2-3 line cross-plugin hints for freeform conversations
5. **Version-pinned MCP server** — pin `@morphllm/morphmcp` to prevent upstream
   breaking changes

<!-- deepen-plan: external -->
> **Research:** The MCP server package (`@morphllm/morphmcp`) is **MIT-licensed**.
> The SDK (`@morphllm/morphsdk`) is **AGPLv3** — we will not use it. The MCP
> server provides full access to both `edit_file` and `warpgrep_codebase_search`
> without needing the SDK. The EULA at https://www.morphllm.com/eula imposes
> restrictions on the hosted API service (no training competing models, no weight
> extraction) but these do not affect plugin distribution.
<!-- /deepen-plan -->

### Graceful Degradation Model

When morph tools fail at runtime (API error, timeout, credits exhausted):
- **Fall back to built-in tools** — `edit_file` failure → use built-in Edit;
  `warpgrep_codebase_search` failure → use built-in Grep
- **Surface the error briefly** — note the fallback in output so user knows
- **Never block a workflow** — morph is an enhancement, not a dependency
- When `MORPH_API_KEY` is not set, the MCP server does not start. All workflows
  continue with built-in tools. No error on session start.

<!-- deepen-plan: external -->
> **Research:** Confirmed via Claude Code official docs: "If a required
> environment variable is not set and has no default value, Claude Code will
> fail to parse the config." Using `${MORPH_API_KEY}` (without a default like
> `${MORPH_API_KEY:-}`) means Claude Code **skips the server entirely** when the
> variable is unset — this is the cleanest failure mode. The server process is
> never started, no error is shown, and built-in tools work normally. This is
> the correct behavior for passive acceleration.
> See: https://code.claude.com/docs/en/mcp
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Plugin Scaffold

- [ ] **1.1:** Create plugin directory structure
- [ ] **1.2:** Write `.claude-plugin/plugin.json` with MCP server configuration
- [ ] **1.3:** Write `.gitattributes` (LF enforcement)
- [ ] **1.4:** Write `package.json` (minimal metadata)
- [ ] **1.5:** Write `CHANGELOG.md` (initial 1.0.0 release)

### Phase 2: Core Documentation

- [ ] **2.1:** Write `CLAUDE.md` — source of truth for tool preference, domain
  separation, and graceful degradation
- [ ] **2.2:** Write `README.md` — user-facing documentation

### Phase 3: Commands

- [ ] **3.1:** Write `commands/morph/setup.md` — prerequisites, API key,
  verification
- [ ] **3.2:** Write `commands/morph/status.md` — API health, MCP state

### Phase 4: Cross-Plugin Hints

- [ ] **4.1:** Add "Optional Enhancement: yellow-morph" to
  `plugins/yellow-core/CLAUDE.md`
- [ ] **4.2:** Add "Optional Enhancement: yellow-morph" to
  `plugins/yellow-review/CLAUDE.md`
- [ ] **4.3:** Add "Optional Enhancement: yellow-morph" to
  `plugins/yellow-debt/CLAUDE.md`
- [ ] **4.4:** Add "Optional Enhancement: yellow-morph" to
  `plugins/yellow-ci/CLAUDE.md`
- [ ] **4.5:** Update `plugins/yellow-research/CLAUDE.md` to reference
  yellow-morph as alternative to global `filesystem-with-morph` MCP

<!-- deepen-plan: codebase -->
> **Codebase:** **Critical: Tool name collision with yellow-research.**
> `plugins/yellow-research/CLAUDE.md` (lines 114-116) already references a
> global `filesystem-with-morph` MCP with the tool name
> `mcp__filesystem-with-morph__warpgrep_codebase_search`. The yellow-morph
> plugin will create a *different* tool name:
> `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search`. If both the
> global MCP and the plugin are configured, users will have **duplicate
> WarpGrep tools** in their session. The plan must include a task to update
> yellow-research's CLAUDE.md and `commands/research/setup.md` to document
> yellow-morph as the preferred alternative, and recommend removing the global
> `filesystem-with-morph` MCP when the plugin is installed.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** The `### Optional Enhancement:` heading is a **novel pattern**
> not used by any existing plugin. Existing patterns:
> - `### Optional Plugin Dependencies` (yellow-core, line 56)
> - `## Optional Dependencies` (yellow-research)
> - `## Cross-Plugin Dependencies` (yellow-ci, yellow-debt, yellow-linear, yellow-chatprd)
>
> All existing patterns document what a plugin needs FROM others, not what
> others gain FROM it. The morph plan inverts this. While architecturally
> sound, it creates a maintenance burden: if yellow-morph is removed, 4 other
> plugins need cleanup. Consider using `### Optional Plugin Dependencies` as
> the heading to match the existing yellow-core pattern, even though the
> direction is inverted.
<!-- /deepen-plan -->

### Phase 5: Marketplace Registration

- [ ] **5.1:** Add yellow-morph entry to `.claude-plugin/marketplace.json`

<!-- deepen-plan: codebase -->
> **Codebase:** The `validate-marketplace.js` script (lines 229-249) verifies
> that each plugin's `source` directory exists AND contains
> `.claude-plugin/plugin.json`. **Order of operations matters:** create the
> plugin directory first (Phase 1), then add to marketplace.json (Phase 5),
> then run validation (Phase 6). If reversed, validation will fail.
<!-- /deepen-plan -->

### Phase 6: Validation

- [ ] **6.1:** Run `pnpm validate:schemas` to verify all JSON schemas pass
- [ ] **6.2:** Verify morph MCP server starts correctly with a test API key

<!-- deepen-plan: codebase -->
> **Codebase:** `pnpm validate:schemas` runs two scripts sequentially:
> `validate-marketplace.js` (checks marketplace.json entries, source paths,
> plugin.json existence) then `validate-plugin.js` (scans all `plugins/*/`
> directories, validates required fields, checks name matches directory name,
> validates keywords). Neither uses JSON Schema validation — both are
> procedural JavaScript checks. The `name` field in plugin.json **must match
> the directory name** (`validate-plugin.js` line 104).
<!-- /deepen-plan -->

## Technical Specifications

### Files to Create

```
plugins/yellow-morph/
  .claude-plugin/plugin.json     # MCP server config
  .gitattributes                 # LF line endings
  CLAUDE.md                      # Source of truth
  README.md                      # User docs
  CHANGELOG.md                   # Keep a Changelog format
  package.json                   # Minimal metadata
  commands/morph/setup.md        # /morph:setup
  commands/morph/status.md       # /morph:status
```

### Files to Modify

- `plugins/yellow-core/CLAUDE.md` — append Optional Enhancement section
- `plugins/yellow-review/CLAUDE.md` — append Optional Enhancement section
- `plugins/yellow-debt/CLAUDE.md` — append Optional Enhancement section
- `plugins/yellow-ci/CLAUDE.md` — append Optional Enhancement section
- `plugins/yellow-research/CLAUDE.md` — update filesystem-with-morph reference
- `plugins/yellow-research/commands/research/setup.md` — update tool name ref
- `.claude-plugin/marketplace.json` — add plugin entry to `plugins` array

### File Contents

#### 1. `.claude-plugin/plugin.json`

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
  "keywords": ["code-editing", "code-search", "fast-apply", "warpgrep", "morph"],
  "mcpServers": {
    "morph-mcp": {
      "command": "npx",
      "args": ["-y", "@morphllm/morphmcp@0.8.110"],
      "env": {
        "MORPH_API_KEY": "${MORPH_API_KEY}",
        "ENABLED_TOOLS": "edit_file,warpgrep_codebase_search",
        "WORKSPACE_MODE": "true"
      }
    }
  }
}
```

<!-- deepen-plan: external -->
> **Research:** Version pinned to `@0.8.110` (current `latest` as of 2026-03-03).
> This follows the pattern used by yellow-research which pins all npx packages:
> `@perplexity-ai/mcp-server@0.8.2`, `tavily-mcp@0.2.17`, `exa-mcp-server@3.1.8`.
> The `-y` flag is required because MCP servers are spawned as non-interactive
> subprocesses with no terminal for user input.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Confirmed environment variables accepted by `@morphllm/morphmcp`:
> - `MORPH_API_KEY` (required) — API authentication
> - `ENABLED_TOOLS` (default: `"edit_file,warpgrep_codebase_search"`) — or `"all"` for full filesystem
> - `WORKSPACE_MODE` (default: `"true"`) — auto-detect project root via `.git`/`package.json`
> - `DEBUG` (default: `"false"`) — verbose logging
> - `MORPH_API_URL` (default: `https://api.morphllm.com`) — for proxies/enterprise
> - `MORPH_WARP_GREP_TIMEOUT` (default: `30000`) — WarpGrep model call timeout in ms
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** The plugin.json schema at `schemas/plugin.schema.json` uses
> `additionalProperties: false`. Allowed fields: `name`, `version`,
> `description`, `author`, `license`, `homepage`, `repository`, `keywords`,
> `mcpServers`, `hooks`. The proposed plugin.json uses only permitted fields.
> All 11 existing plugins include `author` as an object with `name` + `url`.
<!-- /deepen-plan -->

#### 2. `.gitattributes`

```
* text=auto eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
```

<!-- deepen-plan: codebase -->
> **Codebase:** 5 of 11 plugins have no `.gitattributes` at all (gt-workflow,
> yellow-chatprd, yellow-core, yellow-linear, yellow-research). The file is
> not strictly required but is good practice. The plan's format matches
> Pattern A used by yellow-ruvector. Pattern B (used by yellow-ci) also
> includes `*.yml`, `*.yaml`, `*.bats` — not needed for morph since it has
> no YAML or test files.
<!-- /deepen-plan -->

#### 3. `package.json`

```json
{
  "name": "yellow-morph",
  "version": "1.0.0",
  "private": true,
  "description": "Intelligent code editing and search via Morph Fast Apply and WarpGrep"
}
```

#### 4. `CHANGELOG.md`

```markdown
# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-03-03

### Added

- Initial release — Morph Fast Apply and WarpGrep integration via MCP server
- `/morph:setup` command for prerequisites and API key configuration
- `/morph:status` command for API health and MCP tool availability
- CLAUDE.md with tool preference rules and domain separation guidance
- Cross-plugin hints in yellow-core, yellow-review, yellow-debt, yellow-ci

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
```

#### 5. `CLAUDE.md`

```markdown
# yellow-morph Plugin

Intelligent code editing and search via Morph Fast Apply and WarpGrep.

## MCP Server

- **morph-mcp** — Stdio transport via `npx @morphllm/morphmcp@0.8.110`
- Requires `MORPH_API_KEY` environment variable (will not start without it)
- Tools: `edit_file`, `warpgrep_codebase_search`
- Lifecycle: starts on first MCP tool call, shuts down on session end
- First call may be slow (20-40s cold start on first npx download; subsequent
  sessions use npm cache and start in seconds)

## Tool Preference Rules

### edit_file (Fast Apply) vs built-in Edit

- Prefer `mcp__plugin_yellow-morph_morph-mcp__edit_file` when the change spans
  3+ non-contiguous lines OR when the target file exceeds 200 lines
- Continue using built-in Edit for small, precise single-line replacements where
  the exact old_string is known and unique
- Never use `edit_file` for non-code files (.md, .json, .yaml, .yml, .toml,
  .env, .xml, .ini, .cfg) — always use built-in Edit for these
- Fast Apply accepts "lazy edit snippets" with `// ... existing code ...`
  markers — the AI specifies what changes, morph handles the merge
- Scales to 1,500-line files at 99.2% accuracy

### warpgrep_codebase_search (WarpGrep) vs built-in Grep

- Prefer `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search` for
  intent-based queries ("how does authentication work?", "find error handling
  for payment failures", "what calls this function?")
- Continue using built-in Grep for exact pattern matching (regex, literal
  strings, known function names)
- WarpGrep runs in an isolated context window — does not pollute main context
- Completes in 3.8 steps average (sub-6 seconds)
- Auto-excludes node_modules, vendor, build output, .git

## Domain Separation: WarpGrep vs ruvector

When both yellow-morph and yellow-ruvector are installed:

- **WarpGrep** = "find code I haven't seen" — intent-based discovery, stateless,
  no indexing. Use for exploring unfamiliar code, finding callers, blast radius,
  and intent queries.
- **ruvector** = "recall something I learned before" — persistent memory,
  similarity search, indexed. Use for recalling past learnings, finding similar
  patterns, and session memory.

Routing rules:
- Discovery query about unseen code → `warpgrep_codebase_search`
- Recall query about past learning or similar pattern → ruvector tools
- If ruvector is not installed → WarpGrep handles all code search
- If yellow-morph is not installed → ruvector and built-in Grep handle search

## Graceful Degradation

- If `edit_file` fails (API error, timeout, credits exhausted): fall back to
  built-in Edit tool. Note the fallback briefly.
- If `warpgrep_codebase_search` fails: fall back to built-in Grep. Note the
  fallback briefly.
- If `MORPH_API_KEY` is not set: MCP server does not start. All workflows
  continue with built-in tools. No error.
- Morph is an enhancement, never a dependency. No workflow should block on morph
  tool availability.

## Security and Privacy

- **Data transmission:** Both `edit_file` and `warpgrep_codebase_search` send
  code to Morph's API servers (api.morphllm.com)
- **Data retention:** Free/Starter tiers retain data for 90 days. Enterprise
  offers zero-data-retention (ZDR) mode.
- **Sensitive files:** Do not use WarpGrep to search files that may contain
  secrets (.env, credentials.json, private keys). Use built-in Grep for these.
- **API key:** Transmitted via headers (standard HTTPS). Never log or display.
- **Privacy details:** https://morphllm.com/privacy

## Plugin Components

### Commands (2)

- `/morph:setup` — Check prerequisites, configure API key, verify MCP server
- `/morph:status` — Show API health and MCP tool availability

## Git Operations

This plugin does not perform git operations. Graphite commands and git workflows
do not apply.

## Prerequisites

- ripgrep (`rg`) installed — required by WarpGrep for local search
- Node.js 18+ — required for MCP server via npx
- `MORPH_API_KEY` environment variable — obtain from https://morphllm.com
- Network egress to api.morphllm.com (port 443)

## Cost Considerations

- Fast Apply: ~2,000-5,000 credits per edit (~$0.001-$0.005)
- WarpGrep: ~500-2,000 credits per search (~$0.001)
- Free tier: 250K credits/month, 200 requests/month
- Prefer built-in Edit and Grep for trivial operations to conserve credits

## Known Limitations

- Both tools require network connectivity — no offline mode
- Free tier: 250K credits, 200 requests/month (may exhaust in 1-3 active
  sessions)
- WarpGrep timeout: 30s default (configurable via MORPH_WARP_GREP_TIMEOUT env
  var)
- edit_file is not suitable for non-code files (configs, markdown, YAML)
- First npx download may take 20-40s; subsequent sessions use npm cache
- Code is sent to Morph's API — not suitable for air-gapped environments
```

<!-- deepen-plan: external -->
> **Research:** Cold start estimate corrected from "5-15s" to "20-40s" for
> first-ever npx download. Subsequent invocations use npm's local cache and
> start much faster. To reduce latency, users can pre-install globally:
> `npm install -g @morphllm/morphmcp`. Claude Code's MCP startup timeout may
> need consideration — the Morph docs suggest `startup_timeout_sec = 10` for
> some clients, but Claude Code's default is typically sufficient.
<!-- /deepen-plan -->

#### 6. `commands/morph/setup.md`

```markdown
---
name: morph:setup
description: "Check prerequisites and configure Morph API key. Use when first
  installing the plugin, when morph tools fail, or to verify API connectivity."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up yellow-morph

Verify prerequisites, configure MORPH_API_KEY, and verify MCP server
connectivity.

## Workflow

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v rg   >/dev/null 2>&1 && printf 'ripgrep (rg):  OK\n' || printf 'ripgrep (rg):  NOT FOUND\n'
command -v node >/dev/null 2>&1 && printf 'node:          OK (%s)\n' "$(node --version 2>/dev/null)" || printf 'node:          NOT FOUND\n'
command -v npx  >/dev/null 2>&1 && printf 'npx:           OK\n' || printf 'npx:           NOT FOUND\n'
printf '\n=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf '%-20s set (%s...)\n' 'MORPH_API_KEY:' "$(printf '%s' "$MORPH_API_KEY" | head -c 8)" || printf '%-20s NOT SET\n' 'MORPH_API_KEY:'
```

Collect **all** failures before stopping — report them together.

Stop conditions (after reporting all):
- `rg` not found: "ripgrep is required for WarpGrep. Install from
  https://github.com/BurntSushi/ripgrep#installation"
- `node` not found: "Node.js 18+ is required. Install from https://nodejs.org/"
- `npx` not found: "npx is required (bundled with Node.js). Verify Node.js
  installation."

Node version check: If node version is below 18, warn: "Node.js 18+ is
recommended. Current: vX.Y.Z"

`MORPH_API_KEY` not set is a warning, not a stop — continue to Step 2.

### Step 2: API Key Configuration

If `MORPH_API_KEY` is not set:

Ask via AskUserQuestion: "MORPH_API_KEY is not set. Do you have a Morph API
key?"

- **Yes, I have one** → "Please set it in your shell profile and restart Claude
  Code:
  ```bash
  echo 'export MORPH_API_KEY=your-key-here' >> ~/.zshrc  # or ~/.bashrc
  source ~/.zshrc
  ```
  Then re-run `/morph:setup` to verify."
  Show info: "Get a key at https://morphllm.com — free tier includes 250K
  credits/month."
  Stop here (cannot verify without key).

- **No, I need one** → "Sign up at https://morphllm.com to get an API key.
  Free tier includes 250K credits/month (200 requests/month)."
  Show privacy note: "Note: Morph tools send code to Morph's API servers.
  Free/Starter tiers retain data for 90 days. See https://morphllm.com/privacy"
  Stop here.

If `MORPH_API_KEY` is set: continue to Step 3.

### Step 3: Verify API Connectivity

Test API key with a minimal completion call:

```bash
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${MORPH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"test"}],"max_tokens":1}' \
  https://api.morphllm.com/v1/chat/completions 2>/dev/null)
printf 'API response: %s\n' "$HTTP_CODE"
```

- **200**: API key valid. Continue to Step 4.
- **401**: "API key is invalid. Check your MORPH_API_KEY value." Stop.
- **403**: "API key is forbidden. Your account may be suspended." Stop.
- **000 or empty**: "Cannot reach Morph API. Check network connectivity to
  api.morphllm.com." Stop.
- **429**: "Rate limit exceeded. You may have exhausted your free tier credits."
  Warn, continue.

### Step 4: Verify MCP Package

```bash
npm view @morphllm/morphmcp version 2>/dev/null || echo "NPM_LOOKUP_FAILED"
```

- **Version output**: Package accessible. Record version and compare with
  pinned version in plugin.json.
- **NPM_LOOKUP_FAILED**: "Cannot query npm for @morphllm/morphmcp. Check npm
  registry access." Warn, continue.

### Step 5: Report

```text
yellow-morph Setup Check
========================

Prerequisites
  ripgrep (rg)   OK
  node           OK (v22.x.x)
  npx            OK

API
  MORPH_API_KEY   set (morph-k_...)
  API status      OK (authenticated)
  MCP package     @morphllm/morphmcp@0.8.110 (pinned in plugin.json)

Privacy
  Data retention: 90 days (free/starter) | ZDR available (enterprise)
  Code is sent to api.morphllm.com for processing

Overall: PASS
```

Ask via AskUserQuestion: "Setup complete. What would you like to do next?"
Options: "Test morph tools" (suggest a sample edit_file and warpgrep call),
"Check status" (`/morph:status`), "Done".

## Error Handling

| Error | Message | Action |
|---|---|---|
| `rg` not found | "Install ripgrep: https://github.com/BurntSushi/ripgrep" | Collect, stop |
| `node` not found | "Install Node.js 18+: https://nodejs.org/" | Collect, stop |
| `npx` not found | "npx required (bundled with Node.js)" | Collect, stop |
| Node <18 | "Node.js 18+ recommended. Current: vX.Y.Z" | Warn, continue |
| `MORPH_API_KEY` not set | Prompt for key or signup | Guided flow, stop |
| API key invalid (401) | "API key is invalid" | Stop |
| API forbidden (403) | "Account may be suspended" | Stop |
| Network error (000) | "Cannot reach api.morphllm.com" | Stop |
| Rate limit (429) | "Rate limit exceeded" | Warn, continue |
| npm lookup failed | "Cannot query npm registry" | Warn, continue |
```

<!-- deepen-plan: external -->
> **Research:** **Critical fix:** The original plan used `/v1/models` endpoint
> for API key validation. **This endpoint does not exist** in the Morph API.
> The documented endpoints are: `POST /v1/chat/completions` (Apply/WarpGrep),
> `POST /v1/embeddings`, `POST /v1/rerank`. API key validation must be done
> implicitly via a minimal `/v1/chat/completions` call with `max_tokens: 1`.
> See: https://docs.morphllm.com/api-reference/endpoint/apply
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** **Critical fix:** The original plan used
> `npx -y @morphllm/morphmcp --version` to verify the package. The package
> does **not support `--version`** — it is an MCP stdio server, not a CLI tool.
> Running it without MCP client connection will hang or error. Use
> `npm view @morphllm/morphmcp version` instead for package verification.
<!-- /deepen-plan -->

#### 7. `commands/morph/status.md`

```markdown
---
name: morph:status
description: "Show Morph API health and MCP server state. Use when morph tools
  seem slow, to verify connectivity, or to check tool availability."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - ToolSearch
---

# Morph Status

Show API health and MCP tool availability.

## Workflow

### Step 1: Check Environment

```bash
printf '=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf 'MORPH_API_KEY:  set\n' || printf 'MORPH_API_KEY:  NOT SET\n'
[ -n "${MORPH_WARP_GREP_TIMEOUT:-}" ] && printf 'WARP_GREP_TIMEOUT: %s ms\n' "$MORPH_WARP_GREP_TIMEOUT" || printf 'WARP_GREP_TIMEOUT: 30000 ms (default)\n'
```

If `MORPH_API_KEY` is not set: report "MORPH_API_KEY not set. Run `/morph:setup`
to configure." and stop.

### Step 2: Check API Health

```bash
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${MORPH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"ping"}],"max_tokens":1}' \
  https://api.morphllm.com/v1/chat/completions 2>/dev/null)
printf 'API status: %s\n' "$HTTP_CODE"
```

- **200**: API reachable and authenticated
- **401**: "API key invalid"
- **429**: "Rate limit exceeded — credits may be exhausted"
- **Other**: "API unreachable (HTTP $CODE)"

### Step 3: Check MCP Tool Availability

Use ToolSearch to check if morph MCP tools are loaded:

```
ToolSearch query: "+morph edit"
```

Report whether `edit_file` and `warpgrep_codebase_search` are available.

### Step 4: Report

```text
yellow-morph Status
===================

Environment
  MORPH_API_KEY         set
  WARP_GREP_TIMEOUT     30000 ms

API
  Status                OK (200)
  Available models      morph-v3-fast (16K), morph-v3-large (32K),
                        morph-warp-grep-v1

MCP Tools
  edit_file             available | not loaded
  warpgrep_codebase_search  available | not loaded

Overall: HEALTHY | DEGRADED | OFFLINE
```
```

<!-- deepen-plan: external -->
> **Research:** **No credit balance API exists.** The Morph Cloud platform
> (`cloud.morph.so`) has a `/user/usage` endpoint, but this is for a different
> product. The morphllm.com dashboard is the only way to check credit balance.
> The status command description has been updated to remove "credit balance"
> claims. Available models are hardcoded (morph-v3-fast, morph-v3-large,
> morph-warp-grep-v1, morph-embedding-v4) since there is no `/v1/models`
> discovery endpoint.
<!-- /deepen-plan -->

#### 8. Cross-Plugin Hint: yellow-core

Append after the existing "MCP Servers" section (the `context7` description):

```markdown

### Optional Enhancement: yellow-morph

When yellow-morph is installed, two additional MCP tools become available:
`edit_file` (Fast Apply for high-accuracy code merging) and
`warpgrep_codebase_search` (intent-based code discovery). See yellow-morph's
CLAUDE.md for tool preference rules and domain separation with ruvector. These
tools are available in freeform conversations; structured commands use built-in
Edit and Grep.
```

#### 9. Cross-Plugin Hint: yellow-review

Append after the existing "Known Limitations" section (end of file):

```markdown

### Optional Enhancement: yellow-morph

When yellow-morph is installed, `warpgrep_codebase_search` can find related code
across the codebase (callers, similar patterns, blast radius) during freeform
review conversations. Preferred over Grep for intent-based queries like "what
else calls this function?"
```

#### 10. Cross-Plugin Hint: yellow-debt

Append after the existing "Known Limitations" section (end of file):

```markdown

### Optional Enhancement: yellow-morph

When yellow-morph is installed, `warpgrep_codebase_search` can find anti-pattern
instances by intent, and `edit_file` provides higher-accuracy code remediation
on large files during freeform debt-fixing conversations.
```

#### 11. Cross-Plugin Hint: yellow-ci

Append after the existing "Cross-Plugin Dependencies" section (end of file):

```markdown

### Optional Enhancement: yellow-morph

When yellow-morph is installed, `edit_file` is preferred for applying code fixes
to resolve CI failures in freeform conversations, especially in files longer
than 200 lines where built-in edit accuracy degrades.
```

#### 12. yellow-research Update

Update `plugins/yellow-research/CLAUDE.md` "Optional Dependencies" section to
add yellow-morph as the preferred alternative to the global MCP:

```markdown
- **yellow-morph plugin** (preferred) — provides WarpGrep
  (`mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search`) for agentic
  codebase search. Replaces the global `filesystem-with-morph` MCP. When both
  are installed, yellow-morph's plugin-namespaced tool is preferred.
  Install: `/plugin marketplace add KingInYellows/yellow-plugins` (select
  yellow-morph)
```

#### 13. Marketplace Entry

Add to `.claude-plugin/marketplace.json` `plugins` array:

```json
{
  "name": "yellow-morph",
  "description": "Intelligent code editing and search via Morph Fast Apply and WarpGrep",
  "version": "1.0.0",
  "author": {
    "name": "KingInYellows"
  },
  "source": "./plugins/yellow-morph",
  "category": "development"
}
```

## Tool Schemas (Verified from Official Docs)

<!-- deepen-plan: external -->
> **Research:** Exact MCP tool schemas confirmed from Morph documentation:
>
> **edit_file** — 3 required string parameters:
> - `target_filepath`: Path of the file to modify
> - `instructions`: Brief first-person description of the change (used for
>   disambiguation)
> - `code_edit`: Only the changed lines with `// ... existing code ...` markers
>
> **warpgrep_codebase_search** — 1 required string parameter:
> - `query`: Natural language search query (e.g., "Find authentication
>   middleware")
>
> WarpGrep's `repoRoot` is set internally by the MCP server via workspace
> detection, not passed by the LLM. Additional parameters (`excludes`,
> `includes`, `timeout`) are configured via environment variables (e.g.,
> `MORPH_WARP_GREP_TIMEOUT`), not tool input.
>
> Return format for warpgrep: `{ success, contexts: [{ file, content }],
> summary?, error? }`
>
> See: https://docs.morphllm.com/quickstart (edit_file),
> https://docs.morphllm.com/sdk/components/warp-grep/tool (warpgrep)
<!-- /deepen-plan -->

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-morph included
2. Plugin directory matches the canonical structure (plugin.json, .gitattributes,
   CLAUDE.md, README.md, CHANGELOG.md, package.json)
3. Version is synchronized across plugin.json, package.json, marketplace.json,
   and CHANGELOG.md (all 1.0.0)
4. MCP server starts when `MORPH_API_KEY` is set (manual verification)
5. `edit_file` and `warpgrep_codebase_search` appear as available tools when
   the MCP server is running
6. Cross-plugin hints added to all 4 target plugins without breaking their
   existing CLAUDE.md structure
7. `/morph:setup` validates prerequisites and API key
8. `/morph:status` reports API health and tool availability
9. All cross-plugin hints include "freeform conversations" qualifier
10. CLAUDE.md includes graceful degradation, security/privacy, and cost sections
11. yellow-research CLAUDE.md updated to reference yellow-morph as preferred
    alternative to global filesystem-with-morph MCP

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|---|---|
| MORPH_API_KEY not set | Claude Code skips MCP config parse; server never starts; built-in tools work |
| API key invalid at runtime | Tool call fails; Claude falls back to built-in Edit/Grep |
| Credits exhausted | API returns 429; Claude falls back to built-in tools |
| Network loss mid-session | Tool call times out; Claude falls back |
| WarpGrep timeout (>30s) | Falls back to Grep; note the timeout |
| edit_file on non-code file | CLAUDE.md says never use for .md/.json/.yaml etc |
| edit_file on file >1,500 lines | May work but accuracy not benchmarked beyond this |
| npx cold start (20-40s first download) | First tool call slow; suggest global install for speed |
| Both morph and ruvector installed | Domain separation: WarpGrep for discovery, ruvector for recall |
| Morph installed, ruvector absent | WarpGrep handles all intent-based search |
| /morph:setup run when already configured | Idempotent — re-validates everything |
| Free tier rate limit (200 req/mo) | API returns 429; falls back to built-in tools |
| Empty WarpGrep results | Returns empty; Claude falls back to Grep |
| Both yellow-morph and global filesystem-with-morph configured | Two WarpGrep tools exist; CLAUDE.md prefers plugin-namespaced tool |

## v2 Considerations (Deferred)

1. ~~**SDK integration**~~ — **Ruled out.** `@morphllm/morphsdk` is AGPLv3,
   incompatible with our MIT-licensed repo. All functionality is available
   via the MIT-licensed MCP server package. No SDK will be used.
2. **Custom agents** — `morph-edit` agent for multi-file WarpGrep→Fast Apply
   chains. `morph-search` agent for structured search output. These would
   orchestrate MCP tools directly (no SDK needed).
3. **allowed-tools integration** — Update command/agent frontmatter in
   yellow-review, yellow-debt, yellow-ci to include morph MCP tools for use
   within structured command workflows.
4. **Morph Embeddings** — `morph-embedding-v4` (latest model ID) could
   complement ruvector's all-MiniLM-L6-v2 (384-dim) embeddings. Accessible
   via the API directly, no SDK required.
5. **Hooks** — SessionStart hook for connectivity check; Stop hook for usage
   logging.
6. **Version bump cadence** — Monitor `@morphllm/morphmcp` releases (currently
   96+ releases in the 0.8.x range). Consider bumping pinned version monthly or
   on feature releases.

## References

- Brainstorm: `docs/brainstorms/2026-03-03-yellow-morph-plugin-creation-and-integra-brainstorm.md`
- Research: `docs/research/morph-llm-warpgrep-v3-claude-code-plugins.md`
- Morph docs: https://docs.morphllm.com
- MCP quickstart: https://docs.morphllm.com/mcpquickstart
- Claude Code guide: https://docs.morphllm.com/guides/claude-code
- Morph privacy: https://morphllm.com/privacy
- Morph EULA: https://www.morphllm.com/eula
- npm: https://www.npmjs.com/package/@morphllm/morphmcp
- Claude Code MCP env vars: https://code.claude.com/docs/en/mcp
- Plugin conventions: ruvector CLAUDE.md, ci setup command, marketplace.json
