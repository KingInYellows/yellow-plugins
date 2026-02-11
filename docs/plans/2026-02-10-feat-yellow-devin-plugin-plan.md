---
title: "feat: Add yellow-devin plugin for Devin.AI integration"
type: feat
date: 2026-02-10
brainstorm: docs/brainstorms/2026-02-10-yellow-devin-brainstorm.md
---

# feat: Add yellow-devin Plugin

## Enhancement Summary

**Deepened on:** 2026-02-10
**Technical review:** 2026-02-11 (6 agents: architecture, security, simplicity, spec-flow, pattern, agent-native)
**Sections enhanced:** 12
**Research agents used:** 13 (Devin API docs, DeepWiki MCP, architecture-strategist, security-sentinel, agent-native-reviewer, code-simplicity-reviewer, performance-oracle, pattern-recognition-specialist, spec-flow-analyzer, bash-pro, silent-failure-hunter, create-agent-skills, repo-research-analyst)

### Critical Fixes Discovered

1. **MCP tool naming wrong** — Plan used `mcp__plugin_yellow-devin_deepwiki__*` but correct pattern is `mcp__plugin_deepwiki_deepwiki__*` (server key repeated, not plugin name)
2. **DeepWiki tool names wrong** — Actual tools: `ask_question`, `read_wiki_structure`, `read_wiki_contents` (not `search_wiki`, `get_wiki_page`)
3. **Missing `Skill` in allowed-tools** — All commands and agents that reference `devin-workflows` skill need `Skill` in their allowed-tools list
4. **Polling strategy undefined** — Orchestrator had no max polls, interval, backoff, or timeout defined
5. **Session ID format unvalidated** — No regex specified; injection risk in URL path construction
6. **Token format validation missing** — Header injection possible via malformed `DEVIN_API_TOKEN`

### Key Improvements

1. Added Devin API v1 specifics: idempotent session creation, session secrets, `blocked`/`finished` status values, knowledge API
2. Added complete shell error handling patterns: curl exit codes, jq parse failures, HTTP status validation
3. Added explicit polling strategy with exponential backoff (30s base, 1hr max, 120 max polls)
4. Added progressive disclosure structure for SKILL.md (split into reference files)
5. Added 40+ spec flow gaps with recommendations for v1 scope vs deferred
6. Added comprehensive security audit findings (21 issues, 6 critical) — see `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`
7. Corrected marketplace category: `development` (not `productivity`)

### New Considerations Discovered

- Devin MCP at `mcp.devin.ai` auth mechanism unverified — P1 blocker to resolve before implementation
- Devin API supports session secrets (temporary credentials injection) — useful for orchestrator
- DeepWiki MCP is free and unauthenticated; Devin MCP requires API key — fallback order matters
- Rate limit handling needs exponential backoff with max wait cap (not just "retry once")
- Orchestrator context preservation on mid-cycle failure is critical for user experience

---

## Overview

A Claude Code plugin that integrates with Devin.AI to enable multi-agent workflows. Bridges Claude Code's interactive, local-first development with Devin's autonomous session-based execution. Provides task delegation, codebase research via DeepWiki, multi-step orchestration chains, and playbook management.

**Architecture:** Dual-MCP (DeepWiki + Devin) for wiki/research + Shell (curl to REST API v1) for session lifecycle.

**Brainstorm:** [2026-02-10-yellow-devin-brainstorm.md](../brainstorms/2026-02-10-yellow-devin-brainstorm.md)

## Problem Statement

Developers using Claude Code and Devin.AI currently context-switch between tools manually. There's no way to delegate tasks to Devin, monitor sessions, or orchestrate multi-agent workflows without leaving Claude Code. This friction limits the value of having both tools.

## Proposed Solution

A `yellow-devin` plugin following existing marketplace conventions (modeled on `yellow-linear`):

**v1 scope (this plan):**
- **5 commands**: delegate, status, message, cancel, wiki
- **1 agent**: devin-orchestrator (subsumes reviewer logic inline)
- **1 skill**: devin-workflows (shared conventions reference)
- **2 MCP servers**: DeepWiki (public), Devin (private — auth TBD, see P0 blocker)

**Deferred to v2:**
- `/devin:playbook` command — Playbook API endpoints unverified; complex subcommand structure adds scope
- `devin-reviewer` agent — Orchestrator can inline review checks; separate agent adds indirection without core value for v1
- `deepwiki-explorer` agent — `/devin:wiki` command covers quick queries; users can use the built-in Explore agent type for deep research

### Research Insights: Scope Decision (from technical review)

**Simplicity review (6 reviewers agreed):** Defer playbook, reviewer, and explorer to v2. This cuts 1 command and 2 agents without losing core value. The orchestrator inlines review logic (check for PR/artifacts, validate diff quality). Wiki command handles research queries directly.

**Agent-native parity:** All 5 v1 commands have agent-invocable patterns. The orchestrator agent can invoke session lifecycle via Bash (curl). No command is UI-only.

---

## Technical Approach

### Architecture

```
plugins/yellow-devin/
├── .claude-plugin/
│   └── plugin.json
├── CLAUDE.md
├── .gitattributes                     # LF enforcement
├── commands/
│   └── devin/
│       ├── delegate.md                # Create Devin session
│       ├── status.md                  # Check session status
│       ├── message.md                 # Send follow-up message
│       ├── cancel.md                  # Terminate a session
│       └── wiki.md                    # Query DeepWiki/Devin Wiki
├── agents/
│   └── workflow/
│       └── devin-orchestrator.md      # Multi-step workflow chains
├── skills/
│   └── devin-workflows/
│       ├── SKILL.md                   # Main conventions (< 500 lines)
│       ├── api-reference.md           # Devin API endpoint details
│       └── error-codes.md             # Error catalog and remediation
└── config/
    ├── deepwiki.mcp.json
    └── devin.mcp.json

# v2 additions (deferred):
#   commands/devin/playbook.md
#   agents/workflow/devin-reviewer.md
#   agents/research/deepwiki-explorer.md
```

### Research Insights: Architecture

**Progressive disclosure (from skill authoring guide):** SKILL.md should stay under 500 lines. Extract API endpoint details to `api-reference.md` and error codes to `error-codes.md`. Agents reference these via relative links:
```markdown
See [API Reference](../../skills/devin-workflows/api-reference.md) for endpoint details.
```

**Agent heading structure (from skill guide):** Each agent should use:
```markdown
## Examples
2-3 concrete examples with <examples> tags

## System Prompt
Domain expertise + key behaviors + constraints
```

**Dual-transport complexity (architecture review):** The MCP + REST split is justified (Devin MCP only exposes wiki tools, not session management), but adds cognitive load. Mitigate by documenting clearly in CLAUDE.md's "When to Use What" section which operations use MCP vs curl.

### Key Technical Decisions

1. **Auth**: `DEVIN_API_TOKEN` env var. Validated at command entry. Never logged or echoed. **Token format validation:** Must match pattern `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$` — reject before sending to prevent header injection.
2. **Shell safety**: All JSON payloads constructed via `jq` — never string interpolation of user input into curl commands.
3. **Session tracking**: In-memory only for v1 (no local persistence). User provides session ID or sees list of recent sessions from API.
4. **Orchestrator guard**: Max 3 review-fix cycles before escalating to user. **Context preservation:** On failure, dump session ID, iteration count, issues found, and failed fix message for manual recovery.
5. **Timeouts**: `--connect-timeout 5 --max-time 60` for session creation, `--max-time 30` for other mutations, `--max-time 10` for status polls. **(Changed: session creation from 30s to 60s per performance review.)**
6. **Rate limits**: Detect 429, respect `Retry-After` header (cap at 300s max wait), exponential backoff with jitter, max 3 retries, then fail with clear message. **(Changed: from "retry once" to exponential backoff with cap.)**
7. **Wiki routing**: `/devin:wiki` uses Devin MCP first (supports both public and private repos). Falls back to DeepWiki MCP for public repos only — **fallback must be announced to user, not silent**.
8. **Idempotent session creation**: Use `{idempotent: true}` flag when creating sessions to prevent duplicates. Check `is_new_session` in response.
9. **Session ID validation**: Must match `^ses_[a-zA-Z0-9]{20,64}$` before use in URL paths. Reject otherwise.

### Research Insights: API Specifics (from Devin API v1 docs research)

**Endpoints verified:**
- `POST /v1/sessions` — Create session (supports `idempotent: true`, `playbook_id`, `structured_output_schema`)
- `GET /v1/sessions/{id}` — Get session status (returns `status`, `url`, `pull_request_url`, `structured_output`)
- `GET /v1/sessions` — List sessions (supports pagination via `limit`/`offset`)
- `POST /v1/sessions/{id}/messages` — Send message to session
- `POST /v1/sessions/{id}/cancel` — Cancel a session (not DELETE)
- `GET /v1/playbooks` — List playbooks
- `POST /v1/playbooks` — Create playbook
- `POST /v1/sessions/{id}/secrets` — Inject temporary credentials into session
- `GET /v1/knowledge` — List knowledge base entries

**Session status values:** `queued`, `started`, `running`, `blocked`, `finished`, `stopped`, `failed`

**Auth format:** Bearer token, prefix `apk_user_*` (user tokens) or `apk_*` (org tokens)

**Cancellation:** Use `POST /v1/sessions/{id}/cancel` (NOT DELETE). Plan's cancel command should use this endpoint.

**DeepWiki MCP tools (verified):**
- `ask_question(repo, question)` — AI-powered answers about a repository
- `read_wiki_structure(repo)` — Get wiki page tree for a repository
- `read_wiki_contents(repo, page_id)` — Get specific wiki page content
- Endpoint: `https://mcp.deepwiki.com/mcp` (streamable HTTP, NOT the deprecated `/sse`)
- No authentication required

---

### Implementation Phases

#### Phase 1: Foundation (plugin scaffold + core commands)

The essential files and the three most-used commands.

**Deliverables:**
- Plugin scaffold: `plugin.json`, `CLAUDE.md`, `.gitattributes`, MCP configs
- Marketplace registration in `.claude-plugin/marketplace.json`
- `/devin:delegate` command
- `/devin:status` command
- `/devin:cancel` command
- `devin-workflows` SKILL.md (shared conventions)

**Success criteria:**
- User can delegate a task to Devin from Claude Code
- User can check session status and see progress/artifacts
- User can cancel a running session
- `pnpm validate:schemas` passes

**Files:**

### `plugins/yellow-devin/.claude-plugin/plugin.json`

```json
{
  "name": "yellow-devin",
  "version": "1.0.0",
  "description": "Devin.AI integration for multi-agent workflows — delegate tasks, research codebases via DeepWiki, orchestrate plan-implement-review chains",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/kinginyellow"
  },
  "homepage": "https://github.com/kinginyellow/yellow-plugins#yellow-devin",
  "repository": { "type": "git", "url": "https://github.com/kinginyellow/yellow-plugins" },
  "license": "MIT",
  "keywords": ["devin", "deepwiki", "multi-agent", "delegation", "orchestration", "ai-collaboration"],
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp"
    },
    "devin": {
      "type": "http",
      "url": "https://mcp.devin.ai/mcp"
    }
  },
  "entrypoints": {
    "commands": [
      "commands/devin/delegate.md",
      "commands/devin/status.md",
      "commands/devin/message.md",
      "commands/devin/cancel.md",
      "commands/devin/wiki.md"
    ],
    "agents": [
      "agents/workflow/devin-orchestrator.md"
    ],
    "skills": [
      "skills/devin-workflows/SKILL.md"
    ],
    "mcpServers": [
      "config/deepwiki.mcp.json",
      "config/devin.mcp.json"
    ]
  },
  "compatibility": {
    "claudeCodeMin": "2.0.0"
  },
  "permissions": [
    {
      "scope": "network",
      "reason": "Queries DeepWiki MCP for public repository documentation and code analysis",
      "domains": ["mcp.deepwiki.com"]
    },
    {
      "scope": "network",
      "reason": "Queries Devin MCP for private repository documentation and code analysis",
      "domains": ["mcp.devin.ai"]
    },
    {
      "scope": "network",
      "reason": "Manages Devin sessions, messages, attachments, and playbooks via REST API",
      "domains": ["api.devin.ai"]
    },
    {
      "scope": "shell",
      "reason": "Runs curl for Devin API calls, jq for JSON construction, and git for context detection",
      "commands": ["curl", "jq", "git"]
    }
  ]
}
```

### Research Insights: plugin.json

**Marketplace category (from repo conventions research):** Use `"development"` not `"productivity"` in the marketplace entry. Valid categories: development, productivity, security, learning, testing, design, database, deployment, monitoring.

**Pattern recognition finding:** The `mcpServers` key in plugin.json AND in `entrypoints.mcpServers` should both be present (yellow-linear does this). The top-level `mcpServers` provides quick server references while `entrypoints.mcpServers` points to config files.

### `plugins/yellow-devin/config/deepwiki.mcp.json`

```json
{
  "deepwiki": {
    "type": "http",
    "url": "https://mcp.deepwiki.com/mcp"
  }
}
```

### `plugins/yellow-devin/config/devin.mcp.json`

```json
{
  "devin": {
    "type": "http",
    "url": "https://mcp.devin.ai/mcp"
  }
}
```

### `plugins/yellow-devin/.gitattributes`

```
* text=auto eol=lf
```

### `plugins/yellow-devin/CLAUDE.md`

```markdown
# yellow-devin Plugin

Devin.AI integration for multi-agent workflows — delegate tasks, research codebases via DeepWiki, orchestrate plan-implement-review chains.

## MCP Servers

- **DeepWiki** — Public HTTP endpoint at `https://mcp.deepwiki.com/mcp`
  - No authentication required
- **Devin** — Private HTTP endpoint at `https://mcp.devin.ai/mcp`
  - Requires `DEVIN_API_TOKEN` env var (auth mechanism TBD — see Known Limitations)

## Conventions

- **API calls:** All session management via `curl` to `api.devin.ai/v1/`. Auth via `DEVIN_API_TOKEN` env var.
- **JSON construction:** Always use `jq` — never interpolate user input into JSON strings.
- **Shell quoting:** Always quote variables: `"$VAR"` not `$VAR`.
- **Input validation:** Token format `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$`, session ID `^ses_[a-zA-Z0-9]{20,64}$`.
- **Error handling:** Check curl exit code, HTTP status code, jq exit code on every API call.
- **Write safety:** C1 (validate before write), M3 (confirm destructive ops like cancel).

## Plugin Components

### Commands (5)

- `/devin:delegate` — Create a Devin session with a task prompt
- `/devin:status` — Check session status and recent output
- `/devin:message` — Send follow-up message to active session
- `/devin:cancel` — Terminate a running session (requires confirmation)
- `/devin:wiki` — Query DeepWiki/Devin Wiki about a repository

### Agents (1)

**Workflow:**
- `devin-orchestrator` — Multi-step plan→implement→review→fix cycles with Devin

### Skills (1)

- `devin-workflows` — Shared conventions, API reference, error codes

## When to Use What

| Capability | Command | Agent | When to Use |
|-----------|---------|-------|-------------|
| Create session | `/devin:delegate` | devin-orchestrator | Command for one-off delegation; agent for multi-step cycles |
| Check progress | `/devin:status` | devin-orchestrator | Command for manual checks; agent polls automatically |
| Send message | `/devin:message` | devin-orchestrator | Command for ad-hoc messages; agent for review feedback |
| Cancel session | `/devin:cancel` | — | Always manual (M3 destructive op) |
| Research repo | `/devin:wiki` | — | Command for quick queries; use Explore agent type for deep research |

## Known Limitations

- MCP-only for wiki queries — no offline mode
- Session state not persisted locally — after Claude Code restart, use `/devin:status` to re-discover sessions
- Devin MCP auth mechanism at `mcp.devin.ai` unverified — may need to be deferred to v2
- Polling-based session monitoring — no push/webhook support
- Manual retry on transient failures (no auto-reconnect)
```

### `plugins/yellow-devin/skills/devin-workflows/SKILL.md`

```yaml
---
name: devin-workflows
description: >
  Devin workflow patterns and conventions reference. Use when commands or agents
  need Devin API context, session management patterns, or error handling guidance.
user-invocable: false
---
```

Shared conventions reference (not user-invocable):
- API base URL and auth pattern
- `jq` JSON construction patterns for safe shell usage
- Structured output schema definitions
- Error code mapping (401->auth, 403->permissions, 404->not found, 429->rate limit)
- Timeout values per operation type
- Input validation rules (prompt max 8000 chars, message max 2000 chars)
- Write safety tiers for Devin operations
- Session status enum values

### Research Insights: SKILL.md Structure

**Progressive disclosure (skill authoring guide):** Split into:

```
skills/devin-workflows/
  SKILL.md              # Main conventions (< 500 lines)
  api-reference.md      # Full API endpoint docs, request/response schemas
  error-codes.md        # Error catalog with remediation steps
```

**Required headings (skill guide):**
```markdown
## What It Does
## When to Use
## Usage
## Reference
```

**Must use `## Usage` heading (not `## Commands`)** per project conventions.

**Session status enum (from API research):** Document these values explicitly:
- `queued` — Session created, waiting to start
- `started` — Session initializing
- `running` — Session actively working
- `blocked` — Session needs input or hit an issue
- `finished` — Session completed successfully
- `stopped` — Session was cancelled
- `failed` — Session encountered an error

### `commands/devin/delegate.md`

```yaml
---
name: devin:delegate
description: >
  Create a Devin session with a task prompt. Use when user wants to delegate
  work to Devin, says "have Devin do X", "send this to Devin", or
  "delegate to Devin".
argument-hint: "<task description>"
allowed-tools:
  - Bash
  - Read
  - Skill
  - AskUserQuestion
---
```

Workflow:
1. Validate `DEVIN_API_TOKEN` is set and matches format `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$`
2. If `$ARGUMENTS` empty, ask user for task description via AskUserQuestion
3. Validate prompt length (max 8000 chars) — **error with char count and excess, never silently truncate**
4. Construct JSON payload via `jq` (never string interpolation):
   ```bash
   jq -n --arg prompt "$PROMPT" '{prompt: $prompt, idempotent: true}' | \
     curl -s --connect-timeout 5 --max-time 60 \
       -w "\n%{http_code}" \
       -X POST "https://api.devin.ai/v1/sessions" \
       -H "Authorization: Bearer $DEVIN_API_TOKEN" \
       -H "Content-Type: application/json" \
       -d @-
   ```
5. **Check curl exit code** — non-zero means network failure, report with actionable message
6. **Check HTTP status code** — extract from `-w "\n%{http_code}"` pattern
7. **Parse response with `jq`** — check jq exit code, handle malformed JSON
8. Extract session ID, status, URL. Check `is_new_session` for idempotent creation
9. Display: session ID, Devin web URL, initial status
10. Error handling: 401->auth error with remediation steps, 429->rate limit with backoff, 5xx->service error

### Research Insights: delegate command

**Idempotent creation (API research):** Use `{idempotent: true}` to prevent duplicate sessions if the command is retried. The response includes `is_new_session: boolean` to distinguish new vs existing.

**Shell error handling pattern (silent-failure-hunter):** Every curl+jq chain needs:
```bash
response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
curl_exit=$?
if [ $curl_exit -ne 0 ]; then
  echo "ERROR: Network failure (curl exit $curl_exit)"
  echo "Check your internet connection and try again."
  exit 1
fi
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
if [ "$http_code" -ge 400 ]; then
  # Handle specific HTTP errors
fi
session_id=$(echo "$body" | jq -r '.session_id // empty' 2>/dev/null)
if [ -z "$session_id" ]; then
  echo "ERROR: API response missing session ID"
  echo "Response: ${body:0:200}"
  exit 1
fi
```

### `commands/devin/status.md`

```yaml
---
name: devin:status
description: >
  Check status of Devin sessions. Use when user asks "how's Devin doing",
  "check Devin status", "is my task done", or "what's the progress".
argument-hint: "[session-id]"
allowed-tools:
  - Bash
  - Skill
---
```

Workflow:
1. Validate `DEVIN_API_TOKEN` is set
2. If `$ARGUMENTS` contains a session ID (validate format `^ses_[a-zA-Z0-9]{20,64}$`), fetch that specific session
3. If no argument, list recent sessions via `GET /v1/sessions?limit=10`
4. Display: session ID, status, duration, artifacts, PR links
5. If session completed with PR, show PR URL prominently
6. If session status is `blocked`, highlight and suggest `/devin:message` to unblock
7. If session failed, show error message and suggest remediation

### `commands/devin/cancel.md`

```yaml
---
name: devin:cancel
description: >
  Terminate a running Devin session. Use when user wants to stop a session,
  says "cancel Devin", "stop the session", or "kill that task".
argument-hint: "<session-id>"
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---
```

Workflow:
1. Validate `DEVIN_API_TOKEN` and session ID from `$ARGUMENTS` (format validation)
2. Fetch session status first (C1 validation — confirm it exists and is running)
3. Ask user to confirm cancellation (M3 — destructive operation)
4. **POST to `/v1/sessions/{id}/cancel`** (not DELETE — confirmed via API docs)
5. Display confirmation or error

---

#### Phase 2: Communication (message + wiki commands)

**Deliverables:**
- `/devin:message` command
- `/devin:wiki` command

**Success criteria:**
- User can send follow-up messages to active Devin sessions
- User can query DeepWiki about any repository's architecture

**Files:**

### `commands/devin/message.md`

```yaml
---
name: devin:message
description: >
  Send a follow-up message to an active Devin session. Use when user wants
  to give Devin additional context, says "tell Devin to...", "update Devin",
  or "send message to session".
argument-hint: "<session-id> <message>"
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---
```

Workflow:
1. Validate `DEVIN_API_TOKEN`
2. Parse `$ARGUMENTS` — first token is session ID, rest is message
3. If missing session ID or message, prompt via AskUserQuestion
4. Validate session ID format and message length (max 2000 chars) — **error with counts, never truncate**
5. Verify session exists and is in a messageable state: `running` or `blocked` (C1 validation)
6. Construct JSON via `jq`, POST to `/v1/sessions/{id}/messages`
7. Check curl exit code, HTTP status, jq parse
8. Display confirmation

### `commands/devin/wiki.md`

```yaml
---
name: devin:wiki
description: >
  Query DeepWiki or Devin Wiki about a repository. Use when user asks
  "how does X work in repo Y", "explain the architecture of Z", "search
  docs for", or wants to understand an external codebase.
argument-hint: "<question> [--repo owner/name]"
allowed-tools:
  - Bash
  - Skill
  - ToolSearch
  - mcp__plugin_deepwiki_deepwiki__ask_question
  - mcp__plugin_deepwiki_deepwiki__read_wiki_structure
  - mcp__plugin_deepwiki_deepwiki__read_wiki_contents
  - mcp__plugin_devin_devin__ask_question
  - mcp__plugin_devin_devin__read_wiki_structure
  - mcp__plugin_devin_devin__read_wiki_contents
---
```

### Research Insights: MCP Tool Naming (CRITICAL FIX)

**Pattern recognition review found:** The tool naming pattern is `mcp__plugin_<SERVER_KEY>_<SERVER_KEY>__<tool>` based on yellow-linear where `mcp__plugin_linear_linear__get_issue` uses the MCP server key `linear` (from plugin.json `mcpServers.linear`), NOT the plugin name.

For yellow-devin with servers keyed as `deepwiki` and `devin`:
- `mcp__plugin_deepwiki_deepwiki__ask_question` (NOT `mcp__plugin_yellow-devin_deepwiki__*`)
- `mcp__plugin_devin_devin__ask_question` (NOT `mcp__plugin_yellow-devin_devin__*`)

**DeepWiki actual tools (from MCP research):**
- `ask_question(repo, question)` — AI-powered answers
- `read_wiki_structure(repo)` — Get wiki page tree
- `read_wiki_contents(repo, page_id)` — Get specific page

**Note:** Exact prefixed names depend on how Claude Code registers plugin MCP servers. Verify via ToolSearch during implementation. The names above follow the yellow-linear pattern.

Workflow:
1. Parse `$ARGUMENTS` — extract question and optional `--repo` flag
2. If no repo specified, detect from current git remote
3. Try Devin MCP tools first (supports both public and private repos):
   - `ask_question(repository, question)` for AI-powered answers
   - `read_wiki_structure(repository)` for browsing wiki pages
   - `read_wiki_contents(repository, page_id)` for specific pages
4. **If Devin MCP fails, announce fallback explicitly to user:**
   - If repo is private → error (DeepWiki can't access private repos)
   - If repo is public → fall back to DeepWiki MCP with warning
5. Present results: architecture overview, relevant code patterns, source links

---

#### Phase 3: Orchestration (orchestrator agent)

**Deliverables:**
- `devin-orchestrator` agent

**Success criteria:**
- Orchestrator can manage plan->implement->review->fix cycles (max 3 iterations)
- Orchestrator inlines review logic (check PR, validate diff)
- Context preserved on mid-cycle failure (secrets sanitized)

**Files:**

### `agents/workflow/devin-orchestrator.md`

```yaml
---
name: devin-orchestrator
description: >
  Multi-step workflow orchestrator for Claude Code + Devin collaboration.
  Use when user wants a full plan-implement-review-fix cycle, says "orchestrate
  this with Devin", "have Devin implement my plan", or delegates a complex task
  that needs iterative refinement.
model: inherit
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - Task
---
```

Agent body (under 200 lines):
- 2-3 `<examples>` showing orchestration trigger patterns
- References `devin-workflows` skill for API patterns and conventions
- Workflow:
  1. Analyze task and create implementation plan
  2. Create Devin session with plan + structured output schema (use `idempotent: true`)
  3. Poll session status with exponential backoff (see polling strategy below)
  4. Fetch session output (PR, artifacts)
  5. Review output for quality (delegate to devin-reviewer if needed)
  6. If issues found and iteration count < 3: **re-fetch session status** (TOCTOU fix — session may have changed during review), then send fix message to Devin, go to step 3
  7. If iteration count >= 3: escalate to user with summary of issues
  8. If quality acceptable: present results to user
- **Hard limit: 3 review-fix cycles** — prevents infinite loops and cost overruns
- Supports parallel mode: break task into subtasks, create multiple sessions
- **On failure: preserve context** (session ID, iteration count, issues found, failed message)

### Research Insights: Orchestrator Polling Strategy

**Performance review finding:** Polling was completely undefined. Define explicitly:

```
Polling Strategy:
- Initial delay: 30 seconds (Devin needs time to start)
- Base interval: 30 seconds
- Backoff multiplier: 1.5x after 10 polls (45s, 67s, 100s, ...)
- Max interval: 5 minutes
- Max polls: 120 (approx 1 hour effective max)
- Max wall time: 1 hour
- On poll failure (network): retry 3 times with 10s delay, then report error
- On unknown status value: log warning, continue polling
- Terminal states: finished, stopped, failed
- Blocked state: notify user, offer to send message or cancel
```

**Context preservation on failure (silent-failure-hunter):** When message-send fails mid-cycle:
```
CONTEXT DUMP:
- Session ID: {id}
- Iteration: {n}/3
- Issues found: {list}
- Fix message that failed: {message}
- Manual recovery: /devin:message {id} "{message}"
```

**Session secrets (API research):** The orchestrator can inject temporary credentials into a session via `POST /v1/sessions/{id}/secrets`. Useful when Devin needs access to private APIs or services.

### Orchestrator Inline Review Logic (replaces devin-reviewer for v1)

The orchestrator inlines these review checks rather than delegating to a separate agent:

```
Validation checks before approving session output:
1. Session status is terminal (finished/stopped/failed)
2. At least one artifact OR PR URL exists
3. If PR URL: PR exists in GitHub AND has > 0 commits (via `gh pr view`)
4. If artifacts: at least one is non-empty

If any check fails → mark iteration as FAILED, send fix message to Devin
```

---

#### Phase 4: Polish (marketplace registration + validation)

**Deliverables:**
- Register plugin in `.claude-plugin/marketplace.json`
- Run `pnpm validate:schemas` and fix any issues
- Final CLAUDE.md review

**Success criteria:**
- All validation passes
- Plugin discoverable in marketplace
- All "Use when..." trigger clauses present
- All `allowed-tools` lists complete

### `.claude-plugin/marketplace.json` addition

```json
{
  "id": "yellow-devin",
  "name": "yellow-devin",
  "description": "Devin.AI integration for multi-agent workflows — delegate tasks, research codebases via DeepWiki, orchestrate plan-implement-review chains",
  "version": "1.0.0",
  "author": { "name": "KingInYellows" },
  "source": "./plugins/yellow-devin",
  "category": "development"
}
```

### Research Insights: Validation

**Validation commands (from repo conventions):**
```bash
node scripts/validate-plugin.js plugins/yellow-devin    # Plugin manifest
node scripts/validate-marketplace.js                     # Marketplace catalog
pnpm run release:check                                   # All validations
```

**Key validation rules to satisfy:**
- Plugin ID format: kebab-case only (`^[a-z0-9-]+$`)
- Version consistency: marketplace version must match plugin.json
- Category: must be one of 9 official values
- Keywords: kebab-case, max 10, no duplicates of name/description words
- Description: 10-280 chars, not just plugin name
- All entrypoint files must exist
- Homepage URL must match repository domain

---

## Security Considerations

### Shell Injection Prevention

**Critical rule:** Never interpolate user input (`$ARGUMENTS`, messages, prompts) directly into curl commands.

**Safe pattern (use `jq`):**
```bash
jq -n --arg prompt "$USER_INPUT" '{prompt: $prompt}' | \
  curl -s -X POST "https://api.devin.ai/v1/sessions" \
    -H "Authorization: Bearer $DEVIN_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

**Unsafe pattern (never do this):**
```bash
# DANGEROUS — shell injection possible
curl -d "{\"prompt\": \"$USER_INPUT\"}" ...
```

### API Token Security

- Store in `DEVIN_API_TOKEN` env var only
- Validate presence at command entry: `[ -z "$DEVIN_API_TOKEN" ]` -> error with setup instructions
- **Validate format**: Must match `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$` — prevents header injection via malformed tokens
- Never log, echo, or include token in error messages
- Never pass token via `$ARGUMENTS`
- **Never use `curl -v`** — verbose mode prints auth headers to stderr

### Input Validation

Per `devin-workflows` skill:
- Task prompts: max 8000 characters — **error with count, never silently truncate**
- Messages: max 2000 characters — **error with count, never silently truncate**
- Session IDs: validate format `^ses_[a-zA-Z0-9]{20,64}$` before use in API URLs
- Playbook IDs: validate format before use in API URLs
- Playbook names: alphanumeric, dash, underscore only
- Reject path traversal characters (`..`, `/`, `~`, backticks)
- **Check for null bytes** — break jq/shell processing
- **Byte vs character length**: Validate character count (not byte count) for user-facing limits

### Research Insights: Security (21 findings from security-sentinel)

**Full audit:** `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`

**6 Critical issues:**
1. **Token leakage via curl -v** — Never use verbose mode; audit for `-v` flags
2. **Session ID injection** — Unvalidated session IDs in URL paths could allow path traversal
3. **Orchestrator TOCTOU** — Session status can change between check and action; always re-fetch before writes
4. **Missing format validation** — Token and session ID regexes not defined in original plan
5. **Error message token echo** — 401 handler must not echo the token value
6. **Rate limit abuse** — Automatic retry without backoff cap could amplify rate limiting

**Shell security patterns (from bash-pro):**
```bash
# Token format validation (prevents header injection)
validate_token() {
  local token="$1"
  if [ -z "$token" ]; then
    echo "ERROR: DEVIN_API_TOKEN not set"
    echo "Get your API key: https://devin.ai/settings/api"
    echo "Then: export DEVIN_API_TOKEN='apk_...'"
    return 1
  fi
  if ! printf '%s' "$token" | grep -qE '^apk_(user_)?[a-zA-Z0-9_-]{20,128}$'; then
    echo "ERROR: DEVIN_API_TOKEN has invalid format"
    echo "Expected: apk_... or apk_user_..."
    return 1
  fi
}

# Session ID validation (prevents URL path injection)
validate_session_id() {
  local sid="$1"
  if ! printf '%s' "$sid" | grep -qE '^ses_[a-zA-Z0-9]{20,64}$'; then
    echo "ERROR: Invalid session ID format: $sid"
    echo "Session IDs start with 'ses_' followed by alphanumeric characters"
    return 1
  fi
}
```

### Session Secrets Security (P0 — from security-sentinel)

The orchestrator can inject temporary credentials via `POST /v1/sessions/{id}/secrets`. These require strict handling:

1. **Never echo or log secrets** — not in error messages, not in context dumps, not in debug output
2. **Construct via `jq`** — never string-interpolate secrets into JSON payloads
3. **Validate format** — secrets are key=value pairs; reject entries with shell metacharacters (backticks, `$()`, `|`, `;`)
4. **Sanitize context dumps** — before dumping orchestrator context on failure, strip any secrets from the output:
   ```bash
   # Before dumping context, remove secrets
   context=$(echo "$context" | sed 's/DEVIN_API_TOKEN=[^ ]*/DEVIN_API_TOKEN=***REDACTED***/g')
   ```
5. **Scope secrets to session** — secrets are temporary per-session; never persist or cache them locally

### Shell Variable Quoting Rule (P1 — from security-sentinel)

**Always quote shell variables:** Use `"$VAR"` not `$VAR`. Unquoted variables enable word splitting and glob expansion, which can cause unexpected behavior or security issues with special characters in user input.

### Write Safety Tiers

| Operation | Tier | Behavior |
|-----------|------|----------|
| Create session | Medium | Proceed (costs money but user explicitly asked) |
| Send message | Low | Proceed without confirmation |
| Cancel session | High | Confirm before executing (M3) |
| Create playbook | Medium | Proceed (reversible) |
| Chain playbooks + create session | High | Confirm before executing (creates session + chains multiple playbooks = significant cost) |
| Orchestrator auto-retry | Guarded | Max 3 iterations, then escalate |

---

## Error Handling Patterns

### Research Insights: Comprehensive Error Handling (from silent-failure-hunter + bash-pro)

Every command must implement these patterns:

**1. curl exit code checking (CRITICAL — currently missing from all commands):**
```bash
response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
curl_exit=$?
if [ "$curl_exit" -ne 0 ]; then
  echo "ERROR: Network failure connecting to Devin API"
  echo "curl exit code: $curl_exit"
  case "$curl_exit" in
    6)  echo "Could not resolve api.devin.ai — check DNS/internet" ;;
    7)  echo "Could not connect — Devin API may be down" ;;
    28) echo "Request timed out — try again or check network" ;;
    *)  echo "Unexpected network error" ;;
  esac
  # Retry transient network failures (exit 6, 7, 28) with exponential backoff
  if [ "$curl_exit" -eq 6 ] || [ "$curl_exit" -eq 7 ] || [ "$curl_exit" -eq 28 ]; then
    for retry in 1 2 3; do
      delay=$((retry * 5))
      echo "Retrying in ${delay}s (attempt $retry/3)..."
      sleep "$delay"
      response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
      curl_exit=$?
      [ "$curl_exit" -eq 0 ] && break
    done
    [ "$curl_exit" -ne 0 ] && { echo "ERROR: Network failure persisted after 3 retries"; exit 1; }
  else
    exit 1
  fi
fi
```

**2. HTTP status code handling:**
```bash
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

case "$http_code" in
  2[0-9][0-9]) ;; # Success
  401)
    echo "ERROR: Authentication failed (401)"
    echo "Your DEVIN_API_TOKEN was rejected."
    echo "Generate a new token: https://devin.ai/settings/api"
    exit 1 ;;
  403)
    echo "ERROR: Permission denied (403)"
    echo "Your token may lack required scopes."
    exit 1 ;;
  404)
    echo "ERROR: Not found (404)"
    echo "Session or resource does not exist."
    exit 1 ;;
  429)
    # Rate limit handling with retry loop
    for retry_attempt in 1 2 3; do
      retry_after=$(echo "$body" | jq -r '.retry_after // 60')
      jq_exit=$?
      if [ "$jq_exit" -ne 0 ]; then
        echo "ERROR: Failed to parse rate limit response"
        echo "Response preview: ${body:0:200}"
        exit 1
      fi
      if [ "$retry_after" -gt 300 ]; then
        echo "ERROR: Rate limit — API asks for ${retry_after}s wait (too long)"
        exit 1
      fi
      echo "Rate limited. Waiting ${retry_after}s (attempt $retry_attempt/3)..."
      sleep "$retry_after"
      # Retry the request
      response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
      curl_exit=$?
      [ "$curl_exit" -ne 0 ] && { echo "ERROR: Network failure during retry"; exit 1; }
      http_code=$(echo "$response" | tail -n1)
      body=$(echo "$response" | sed '$d')
      # If no longer rate limited, break out
      [ "$http_code" != "429" ] && break
    done
    # If still 429 after retries, exit
    if [ "$http_code" = "429" ]; then
      echo "ERROR: Rate limit persisted after 3 retry attempts"
      exit 1
    fi
    ;;
  5[0-9][0-9])
    echo "ERROR: Devin API server error ($http_code)"
    echo "Try again in a few minutes."
    exit 1 ;;
  *)
    echo "ERROR: Unexpected HTTP status $http_code"
    echo "Response: ${body:0:200}"
    exit 1 ;;
esac
```

**3. jq parse error handling:**
```bash
session_id=$(echo "$body" | jq -r '.session_id // empty' 2>/dev/null)
jq_exit=$?
if [ $jq_exit -ne 0 ]; then
  echo "ERROR: Failed to parse API response"
  echo "Response preview: ${body:0:200}"
  echo "This may indicate an API change or proxy interference."
  exit 1
fi
if [ -z "$session_id" ]; then
  echo "ERROR: Response missing expected field 'session_id'"
  echo "$body" | jq . 2>/dev/null || echo "$body"
  exit 1
fi
```

---

## Acceptance Criteria

### Functional Requirements (v1)

- [ ] `/devin:delegate` creates a Devin session and returns session ID + URL
- [ ] `/devin:status` shows session status, progress, artifacts for a given session ID
- [ ] `/devin:status` without ID lists recent sessions via `GET /v1/sessions?limit=10`
- [ ] `/devin:message` sends a message to a running session
- [ ] `/devin:cancel` terminates a session with user confirmation (endpoint TBD — verify POST cancel vs DELETE)
- [ ] `/devin:wiki` returns documentation about a repository via MCP
- [ ] `/devin:wiki` fallback to DeepWiki is announced to user, not silent
- [ ] `devin-orchestrator` manages a plan->implement->review->fix cycle (max 3 iterations)
- [ ] `devin-orchestrator` re-fetches session status before sending fix messages (TOCTOU fix)
- [ ] `devin-orchestrator` preserves sanitized context on mid-cycle failure (no secrets in dump)
- [ ] `devin-orchestrator` inlines review checks (PR exists, has commits, diff looks reasonable)

### Non-Functional Requirements

- [ ] All commands validate `DEVIN_API_TOKEN` format before API calls
- [ ] All user input sanitized via `jq` for JSON construction
- [ ] All curl calls check exit code for network failures
- [ ] All HTTP responses check status code with specific error messages
- [ ] All jq invocations check exit code for parse failures
- [ ] Token validated against `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$` (with max-length cap)
- [ ] Session IDs validated against `^ses_[a-zA-Z0-9]{20,64}$` (with max-length cap)
- [ ] Curl timeouts: `--connect-timeout 5 --max-time 60` (creation), `--max-time 30` (mutations), `--max-time 10` (polls)
- [ ] Network failures (curl exit 6, 7, 28) retry with exponential backoff, max 3 retries
- [ ] Rate limit handling: exponential backoff, max 300s wait, max 3 retries
- [ ] Session secrets never echoed, logged, or included in context dumps
- [ ] All shell variables quoted (`"$VAR"` not `$VAR`)
- [ ] All agent files under 200 lines
- [ ] All descriptions include "Use when..." trigger clause with WHAT + WHEN
- [ ] All `allowed-tools` lists complete and include `Skill` where skill is referenced
- [ ] LF line endings enforced via `.gitattributes`
- [ ] Input length errors show actual count vs maximum (never silently truncate)
- [ ] Grep for `DEVIN_API_TOKEN` in all error paths — verify token value never appears in output

### Quality Gates

- [ ] `pnpm validate:schemas` passes (marketplace + plugin manifests)
- [ ] All entrypoint files exist and are well-formed
- [ ] CLAUDE.md documents all components, conventions, "When to Use What", and limitations
- [ ] Security patterns (C1, M3) applied consistently
- [ ] MCP tool names verified via ToolSearch during implementation
- [ ] SKILL.md under 500 lines with progressive disclosure to reference files

---

## Dependencies & Prerequisites

- **Devin API key** — user must have a Devin account with API access
- **`jq` installed** — required for safe JSON construction in shell commands. **Check at command entry:** `command -v jq >/dev/null || { echo "ERROR: jq required. Install: https://jqlang.github.io/jq/download/"; exit 1; }`
- **`curl` installed** — universal, should be available everywhere
- **MCP server access** — `mcp.deepwiki.com` and `mcp.devin.ai` must be reachable
- **yellow-plugins repo** — plugin added to existing marketplace

### Research Insights: Dependencies

**P1 Blocker (architecture review + pattern recognition):** Devin MCP at `mcp.devin.ai` — authentication mechanism not yet verified. Does it use the same `DEVIN_API_TOKEN`? Separate OAuth? The config file doesn't include auth headers. **Must resolve before implementation by testing the endpoint or checking Devin MCP docs.**

**If Devin MCP requires auth that can't be configured in the simple HTTP MCP format**, the `devin.mcp.json` config may need to be restructured or the Devin MCP integration deferred to v2.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Devin API v1 endpoints change | Low | High | Pin to v1, document version in SKILL.md |
| MCP tool names differ from expected pattern | Medium | Medium | Use ToolSearch to discover actual names, document in SKILL.md |
| Devin MCP auth mechanism unknown | **High** | **High** | **P1: Test `mcp.devin.ai` endpoint before implementation. If auth can't be configured, defer Devin MCP to v2 and use DeepWiki MCP only** |
| DeepWiki MCP rate limits | Low | Low | Graceful error messages, suggest waiting |
| User doesn't have `jq` installed | Low | High | Check at command entry, provide install instructions |
| Structured output schema not respected by Devin | Medium | Medium | Reviewer agent handles malformed responses gracefully |
| Orchestrator burns excessive Devin credits | Low | High | Hard 3-iteration limit, user confirmation for new cycles |
| curl network failures (DNS, timeout) | Medium | Medium | Check curl exit code, provide specific remediation per error code |
| jq parse failures on malformed API response | Medium | Medium | Check jq exit code, show response preview |
| Session polling hangs indefinitely | Medium | High | Max 120 polls, 1hr wall time, exponential backoff |
| Rate limit retry amplification | Low | Medium | Exponential backoff with 300s cap, max 3 retries |

---

## Spec Flow Gaps (from spec-flow-analyzer)

### Addressed in v1

- Session lifecycle: create -> monitor -> message -> cancel fully covered
- Error handling patterns defined for all HTTP codes and network failures
- Orchestrator cycle limit and context preservation specified
- Input validation with explicit error messages (no silent truncation)
- Write safety tiers for all operations
- Polling strategy with exponential backoff and hard limits

### Deferred to v2

**Components deferred (from technical review simplification):**
- `/devin:playbook` command — Playbook API endpoints unverified; complex subcommand structure
- `devin-reviewer` agent — Orchestrator inlines review checks for v1
- `deepwiki-explorer` agent — Wiki command + built-in Explore agent covers deep research

**Features deferred:**
- **Session resume** — Resume monitoring of a previously started session after Claude Code restart
- **Session persistence** — Local storage of session IDs and outcomes (known v1 limitation)
- **Bulk operations** — Cancel multiple sessions, bulk status check
- **Knowledge base sync** — Auto-sync CLAUDE.md to Devin's Knowledge Base
- **Attachment support** — Attach local files to Devin sessions
- **Structured output templates** — Predefined schemas for common task types
- **Webhook/streaming** — Replace polling with push-based session updates
- **Cost tracking** — Display ACU consumption per session
- **Multi-repo wiki** — Query DeepWiki across multiple repositories in one request
- **Playbook templating** — Create playbooks from command history

---

## Open Questions (Resolve During Implementation)

1. **Devin MCP auth (P1 BLOCKER)**: How does the Devin MCP server at `mcp.devin.ai` authenticate? Test the endpoint with Bearer token. If it doesn't work with simple HTTP MCP config, defer Devin MCP to v2.
2. **MCP tool naming**: Verify exact prefixed tool names via ToolSearch after MCP servers are configured. Expected pattern: `mcp__plugin_deepwiki_deepwiki__*` and `mcp__plugin_devin_devin__*`.
3. **Session ID format**: Verify actual session ID format from Devin API responses. The regex `^ses_[a-zA-Z0-9]{20,64}$` is assumed — adjust based on actual responses.
4. **Cancel endpoint**: Verify `POST /v1/sessions/{id}/cancel` is the correct cancellation endpoint (not DELETE).
5. **Playbook API**: Verify `GET /v1/playbooks` and `POST /v1/playbooks` endpoints exist. The Devin API docs may have different paths.
6. **Session listing pagination**: Verify `GET /v1/sessions` supports `limit`/`offset` parameters.

---

## References & Research

### Internal References

- Plugin template: `plugins/yellow-linear/` (MCP + shell pattern)
- Plugin manifest: `plugins/yellow-linear/.claude-plugin/plugin.json`
- Command pattern: `plugins/yellow-linear/commands/linear/sync.md`
- Agent pattern: `plugins/yellow-linear/agents/workflow/linear-issue-loader.md`
- Skill pattern: `plugins/yellow-linear/skills/linear-workflows/SKILL.md`
- Security patterns: `docs/solutions/security-issues/yellow-linear-plugin-multi-agent-code-review.md`
- Shell security: `docs/solutions/security-issues/claude-code-plugin-review-fixes.md`
- Validation: `docs/validation-guide.md`, `docs/plugin-validation-guide.md`
- Skill authoring: `plugins/yellow-core/skills/create-agent-skills/SKILL.md`

### External References

- Devin REST API docs: https://docs.devin.ai/api-reference/overview
- Devin API v1 reference: https://docs.devin.ai/api-reference/list-sessions
- DeepWiki: https://deepwiki.com/
- DeepWiki MCP: https://mcp.deepwiki.com/mcp (streamable HTTP endpoint)
- Devin MCP: https://mcp.devin.ai/mcp
- Community CLI (reference only): https://github.com/revanthpobala/devin-cli

### Security Audit

- Full audit: `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`
- Pattern review: `docs/reviews/2026-02-10-yellow-devin-pattern-review.md`

### Brainstorm

- [2026-02-10-yellow-devin-brainstorm.md](../brainstorms/2026-02-10-yellow-devin-brainstorm.md)

---

## Technical Review Summary (2026-02-11)

**6 specialized review agents** analyzed this plan. Results:

| Dimension | Rating | Key Finding |
|-----------|--------|-------------|
| Architecture | SOLID with GAPS | Dual-transport justified; document MCP vs REST boundary clearly |
| Security | 6/10 → HARDENED | Max-length regex caps added, secrets pattern defined, context dump sanitization added |
| Simplicity | SIMPLIFIED | Scope cut from 6 commands/3 agents to 5 commands/1 agent; playbook/reviewer/explorer deferred |
| Spec Completeness | 8 flows covered | Session persistence documented as known limitation; 10 flows deferred to v2 |
| Pattern Compliance | 9.1/10 | CLAUDE.md template added, SKILL.md frontmatter added, minor issues resolved |
| Agent-Native Parity | FIXED | Skill tool in allowed-tools, MCP naming corrected, orchestrator uses Bash for session mgmt |

**P0 items resolved in this revision:**
1. Validation regex max-length caps: token `{20,128}`, session ID `{20,64}`
2. Session secrets security pattern defined
3. Cancel endpoint marked as TBD (verify POST cancel vs DELETE during implementation)
4. Devin MCP auth blocker documented with fallback strategy

**P1 items resolved in this revision:**
5. Scope simplified: 5 commands, 1 agent, 1 skill
6. Playbook chaining write tier: Medium → High
7. Orchestrator TOCTOU fix: re-fetch status before sending fix messages
8. Network failure retry logic: curl exit 6/7/28 retry with backoff
9. Context dump sanitization: strip secrets before dumping
10. Explicit CLAUDE.md template with all required sections
11. SKILL.md frontmatter with `user-invocable: false`
12. Session persistence documented as known v1 limitation
13. Shell variable quoting rule added
14. Token echo audit added to acceptance criteria
