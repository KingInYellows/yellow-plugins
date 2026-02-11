# Brainstorm: yellow-devin Plugin

**Date:** 2026-02-10
**Status:** Draft
**Author:** KingInYellows

---

## What We're Building

A Claude Code plugin called `yellow-devin` that integrates with Devin.AI to enable multi-agent workflows. The plugin bridges Claude Code's interactive, local-first development with Devin's autonomous session-based execution, creating a collaborative system where both AI agents coordinate on complex tasks.

### Core Capabilities

1. **Task Delegation** — Fire off autonomous Devin sessions from within Claude Code. Create sessions, send follow-up messages, monitor progress, and retrieve results without leaving the terminal.

2. **Codebase Research via DeepWiki** — Query DeepWiki (public repos) and Devin Wiki (private repos) to understand external codebases, dependencies, and architecture. Useful for onboarding to new libraries or understanding upstream projects.

3. **Multi-Agent Orchestration** — Full workflow chains where Claude Code plans work, delegates implementation to Devin, reviews the output, and sends Devin back with fixes. Supports parallel session spawning for independent tasks.

4. **Playbook Management** — Create, list, and chain Devin Playbooks (reusable workflow templates) to standardize repeatable tasks across the team.

---

## Why This Approach

### Architecture: Dual-MCP + Shell Orchestrator

The plugin uses **two integration surfaces**:

- **MCP Servers** for research/wiki queries (feels like native Claude Code tools)
  - DeepWiki MCP at `mcp.deepwiki.com` — free, public repo documentation
  - Devin MCP at `mcp.devin.ai` — authenticated, private repo documentation
- **Shell/REST API** for session lifecycle management (create, message, monitor, terminate)
  - Devin REST API v1 at `api.devin.ai/v1/`
  - Called via `curl` with Bearer token from `DEVIN_API_TOKEN` env var

**Why not pure MCP?** Devin's MCP servers only expose wiki/search tools, not session management. The REST API is required for creating sessions, sending messages, and monitoring progress.

**Why not pure shell?** MCP tools feel native in Claude Code — they appear as discoverable tools with schemas. Wiki queries through MCP are more ergonomic than raw curl commands.

**Precedent:** This mirrors `yellow-linear`'s pattern (MCP for Linear tools + shell for git operations).

### Auth: Full Devin Account Required

All features require a Devin API key. This simplifies the plugin (no tiered logic) and targets the audience that gets the most value — teams already using Devin who want to bridge it with Claude Code.

---

## Key Decisions

### 1. Plugin Structure

```
plugins/yellow-devin/
├── .claude-plugin/
│   └── plugin.json
├── CLAUDE.md
├── commands/
│   └── devin/
│       ├── delegate.md          # Create a Devin session with a task
│       ├── status.md            # Check session status and recent output
│       ├── message.md           # Send follow-up message to active session
│       ├── wiki.md              # Query DeepWiki/Devin Wiki about a repo
│       └── playbook.md          # List/create/chain playbooks
├── agents/
│   ├── workflow/
│   │   ├── devin-orchestrator.md   # Multi-step workflow chains
│   │   └── devin-reviewer.md       # Review Devin's output and iterate
│   └── research/
│       └── deepwiki-explorer.md    # Explore external codebases via DeepWiki
├── skills/
│   └── devin-workflows/
│       └── SKILL.md                # Conventions, patterns, API reference
└── config/
    ├── deepwiki.mcp.json
    └── devin.mcp.json
```

### 2. Commands (5)

| Command | Purpose | Tools |
|---------|---------|-------|
| `/devin:delegate` | Create a Devin session with a task prompt. Supports attaching files and specifying structured output schemas. | Bash (curl), Read |
| `/devin:status` | Check status of active/recent Devin sessions. Shows progress, output, and artifacts. | Bash (curl) |
| `/devin:message` | Send a follow-up message to an active Devin session (e.g., course corrections, additional context). | Bash (curl) |
| `/devin:wiki` | Query DeepWiki or Devin Wiki about a repository. Search docs, get pages, ask questions. | DeepWiki MCP tools, Devin MCP tools |
| `/devin:playbook` | List available playbooks, create new ones, or chain playbooks into a session. | Bash (curl) |

### 3. Agents (3)

| Agent | Category | Purpose |
|-------|----------|---------|
| `devin-orchestrator` | workflow | Multi-step orchestration: Claude Code plans → Devin implements → Claude Code reviews → Devin fixes. Manages parallel sessions for independent tasks. |
| `devin-reviewer` | workflow | Reviews Devin's session output (PRs, code changes) for quality, security, and correctness. Generates structured feedback that can be sent back to Devin. |
| `deepwiki-explorer` | research | Deep research agent for understanding external codebases. Queries DeepWiki for architecture, patterns, and implementation details. |

### 4. Skills (1)

| Skill | Purpose |
|-------|---------|
| `devin-workflows` | Shared conventions, API reference, session management patterns, error handling, and structured output schemas. |

### 5. MCP Servers

- **DeepWiki MCP** (`mcp.deepwiki.com`) — public repo documentation, no auth
- **Devin MCP** (`mcp.devin.ai`) — private repo documentation, requires Devin API key

Both configured as HTTP MCP servers in `config/` directory, following `yellow-linear` pattern.

### 6. Orchestration Workflow Patterns

**Pattern A: Sequential Chain (Plan → Implement → Review → Fix)**
```
Claude Code: Analyze requirements, create implementation plan
    ↓
Devin Session: Implement based on plan (structured output)
    ↓
Claude Code: Review implementation for quality/security
    ↓
Devin Session: Apply review feedback, iterate
    ↓
Claude Code: Final approval, merge
```

**Pattern B: Parallel Delegation**
```
Claude Code: Break task into N independent subtasks
    ↓
Devin Sessions (1..N): Each handles one subtask in parallel
    ↓
Claude Code: Collect results, review all, integrate
```

**Pattern C: Research → Delegate**
```
Claude Code: Query DeepWiki to understand external dependency
    ↓
Claude Code: Use understanding to write precise task spec
    ↓
Devin Session: Execute task with full context
```

### 7. Session Management

All session commands use Devin REST API v1 (`api.devin.ai/v1/`) via `curl`. Covers session CRUD, messaging, attachments, and playbook management. Auth via `DEVIN_API_TOKEN` env var.

**Why raw `curl`:** No official Devin CLI exists. The community `devin-cli` (pip) is third-party and could break. Plugin commands are instructions for Claude, which constructs curl calls perfectly — no ergonomic cost. Matches yellow-linear pattern (direct tool/API calls, no third-party CLIs).

### 8. Agent-to-Agent Communication

Devin sessions support structured output schemas — machine-readable JSON responses that enable automated handoffs between Claude Code and Devin. The orchestrator and reviewer agents use these for status checks, artifact collection, and feedback loops.

### 9. Permissions

Network access to three domains: `mcp.deepwiki.com`, `mcp.devin.ai`, `api.devin.ai`. Shell access for `curl` (API calls) and `git` (context detection). Full details defined during planning.

---

## Workflow Examples

### Example 1: Delegate a Bug Fix

```
User: /devin:delegate Fix the memory leak in the WebSocket handler. See issue #234.

Claude Code:
1. Reads issue #234 for context
2. Creates Devin session with prompt + structured output schema
3. Returns session ID and monitoring link
4. User continues working locally

Later:
User: /devin:status
→ Shows Devin created PR #456, tests passing, 3 files changed
```

### Example 2: Research an External Library

```
User: /devin:wiki How does authentication work in the Stripe Ruby SDK?

Claude Code:
1. Queries DeepWiki MCP: search_wiki("stripe/stripe-ruby", "authentication")
2. Retrieves relevant wiki pages
3. Presents architecture overview, key files, and code patterns
```

### Example 3: Full Orchestration Chain

```
User: Refactor our payment system to support multiple providers.

devin-orchestrator agent:
1. Claude Code analyzes current payment code, creates plan
2. Breaks into subtasks: abstract interface, Stripe adapter, PayPal adapter, tests
3. Delegates Stripe adapter + PayPal adapter to parallel Devin sessions
4. Claude Code reviews both implementations
5. Sends review feedback to Devin sessions
6. Devin fixes issues
7. Claude Code integrates, runs final tests, merges
```

### Example 4: Playbook-Driven Workflow

```
User: /devin:playbook chain "security-audit,dependency-update"

Claude Code:
1. Creates Devin session chaining two playbooks
2. Devin runs security audit → then dependency update
3. Returns structured results for each step
```

---

## Open Questions

1. **Session polling vs webhooks** — Does Devin's API support webhooks or streaming for session updates? If not, `/devin:status` will poll. Verify during planning.

2. **Cost visibility** — Should `/devin:status` include ACU consumption? Useful for budget-conscious teams. Decide during planning based on API availability.

3. **Error recovery** — When a Devin session gets stuck, should the orchestrator surface status and let the user decide, or include automatic timeout/retry? (Leaning toward surface-only for v1 — simpler, avoids runaway costs.)

### Resolved / Deferred

- **~~Devin CLI vs raw curl~~** — Decided: raw `curl`. There is no official Devin CLI — only the community `devin-cli` (pip package by revanthpobala). Since plugin commands are instructions for Claude (not user-run scripts), curl is the right choice: zero install dependency, full control over requests/responses, and no risk of a third-party package breaking. Users who want direct terminal access to Devin can install `devin-cli` separately.
- **~~Knowledge base sync~~** — Deferred to v2. Auto-syncing CLAUDE.md to Devin's Knowledge Base is valuable but adds scope. Start with manual context in prompts.
- **~~Session history~~** — Deferred to v2. Rely on Devin's web UI for history. Local logging adds complexity without core value.

---

## Technical Risks

- **Devin API stability** — REST API v1 is production but endpoints may evolve. Pin to v1, document any version-specific behavior.
- **MCP server availability** — Both DeepWiki and Devin MCP servers are external services. Commands should fail gracefully with clear error messages.
- **Rate limiting** — Devin API has rate limits (429 responses). Session creation and message endpoints need backoff handling.
- **Structured output reliability** — Devin may not always conform perfectly to output schemas. The reviewer agent should handle malformed responses.

---

## Success Criteria

- A developer using Claude Code can delegate tasks to Devin without switching context
- DeepWiki queries return useful codebase insights within Claude Code
- The orchestrator agent can manage a full plan → implement → review → fix cycle
- Plugin follows all yellow-plugins conventions (validation passes, security patterns, CLAUDE.md)
- Session management commands feel responsive and informative

---

## Next Steps

1. `/workflows:plan` — Create detailed implementation plan
2. Implement commands first (core value)
3. Add agents for orchestration
4. Write SKILL.md with conventions and API reference
5. Validate against plugin-validation-guide.md
