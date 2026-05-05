---
title: 'Subagent Frontmatter Field Catalog'
date: 2026-05-04
category: code-quality
track: knowledge
problem: Claude Code subagent .md frontmatter fields — required, optional, version history, scope precedence
tags: [subagents, frontmatter, agents, permissionMode, isolation, effort, disallowedTools, skills, mcpServers, memory]
components: [agents, plugin-authoring, frontmatter-parser]
---

## Context

Subagent `.md` files in Claude Code use a YAML frontmatter block to declare
identity, capabilities, model, permissions, and runtime behavior. The body
below the frontmatter becomes the subagent's system prompt verbatim. Only
`name` and `description` are required. Unknown keys are silently ignored;
invalid values typically cause the field to be ignored or the agent to fail to
spawn.

Sources: [docs.anthropic.com/en/docs/claude-code/sub-agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents) (primary, verified 2026-05-04 via Perplexity),
[code.claude.com/docs/en/subagents](https://code.claude.com/docs/en/subagents),
[/agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript),
[/changelog](https://code.claude.com/docs/en/changelog),
[/hooks](https://code.claude.com/docs/en/hooks),
[/permission-modes](https://code.claude.com/docs/en/permission-modes).

---

## Guidance

### Required fields

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Lowercase `a-z`, digits, hyphens only. No spaces, underscores, uppercase. Convention: matches filename minus `.md`. |
| `description` | `string` (single-line) | **Must be single-line inline.** Folded scalars (`>`) and literal blocks (`|`) silently truncate to first line (parser bug, GH #10504). Include a "Use when…" trigger clause for reliable automatic delegation. |

### Optional fields — behavioral

| Field | Type | Default | Added |
|---|---|---|---|
| `tools` | comma-string or list | inherit all | v2.0.28 |
| `disallowedTools` | comma-string or list | none | v2.0.x late 2025 |
| `model` | enum alias or full model ID | `inherit` | v2.0.28 |
| `permissionMode` | enum (see below) | inherit from parent | v2.0.43 |
| `effort` | `low`/`medium`/`high`/`xhigh`/`max` or integer | inherit | v2.0.x late 2025 |
| `maxTurns` | positive integer | no limit | v2.0.x late 2025 |
| `isolation` | `worktree` (only valid value) | none | v2.1.49 |
| `background` | boolean | `false` | v2.0.x |
| `skills` | list of skill names | none | v2.0.43 |
| `mcpServers` | list or inline mapping | inherit from session | v2.1.117+ (main-thread) |
| `memory` | `user`/`project`/`local` | none | SDK-level |
| `hooks` | event → handler mapping | none | v2.0.42 |
| `initialPrompt` | string | none | SDK-level |
| `color` | `red`/`blue`/`green`/`yellow`/`purple`/`orange`/`pink`/`cyan` | none | undocumented until GH #19292 |

### `permissionMode` enum and inheritance

| Value | Behavior |
|---|---|
| `default` | Standard — prompts for approval before risky actions |
| `acceptEdits` | Auto-accepts file edits + common filesystem commands in working dir |
| `auto` | Background classifier auto-approves most commands, prompts on risky |
| `dontAsk` | Auto-denies permission prompts; only pre-approved tools run |
| `bypassPermissions` | Skips all prompts except protected paths (`.git`, `.claude`, `.vscode`, `.husky`) |
| `plan` | Read-only exploration; no edits or command execution |

**Inheritance rules:**
- Parent uses `bypassPermissions` or `acceptEdits` → subagent `permissionMode` is **ignored**; parent mode takes precedence.
- Parent uses `auto` → subagent inherits `auto`; frontmatter ignored.
- All other cases → subagent frontmatter overrides parent.
- Plugin agents: `permissionMode` is **always silently dropped** for plugin-shipped subagents (security boundary). Same for `hooks` and `mcpServers` — see "Plugin subagent restrictions" below.

### `tools` and `disallowedTools` semantics

`tools` is an explicit allowlist — omitting it inherits all parent tools; specifying it restricts to exactly those listed. `disallowedTools` is a denylist applied after the allowlist. Both accept comma-separated strings or YAML list form.

Bash can be restricted to command prefixes: `Bash(git *)`, `Bash(npm:*)`. The `tools` allowlist also supports `Agent(<subagent-name>)` to restrict which subagents can be spawned.

Do NOT include `Task` in a subagent's `tools` — subagents cannot spawn other subagents.

MCP tool naming: `mcp__plugin_<pluginName>_<serverName>__<toolName>`.

### `isolation: worktree`

Runs the subagent in a temporary git worktree (isolated repository copy). The worktree is created before the subagent starts and auto-cleaned up if no changes are made. Useful for parallel code changes or prototype work that may be discarded.

Only `worktree` is officially documented as of May 2026. Values like `strict`, `shared`, `fork` appear in third-party research but are not in official docs — do not use them.

### `memory` storage locations

| Value | Path | VCS-trackable |
|---|---|---|
| `user` | `~/.claude/agent-memory/<name>/` | No |
| `project` | `.claude/agent-memory/<name>/` | Yes |
| `local` | `.claude/agent-memory-local/<name>/` | No |

**`memory: true` (boolean form) is invalid** — silently ignored. Must use the string scopes `user`/`project`/`local`. Any pre-existing agent with `memory: true` predates the scope-string spec and is doing nothing until corrected.

**`memory:` is a tool expansion**, not just a storage flag. Setting any scope auto-grants `Read`, `Write`, and `Edit` to the subagent **regardless of its `tools:` allowlist**. For agents documented as read-only (e.g., review agents that "report findings, do NOT edit"), the read-only contract becomes prompt-level only — the runtime permission is full read/write. Validate at PR-review time: when an author adds `memory:`, re-check the agent's tool-allowlist semantics still match its documented contract.

**Fix for read-only agents that need `memory:`:** add `disallowedTools: [Write, Edit, MultiEdit]` alongside `memory: project`. The denylist is applied after the `memory:` grant, so `Read` still works for memory file access but write operations are blocked at runtime.

```yaml
# Review agent that must not edit files:
memory: project
disallowedTools: Write, Edit, MultiEdit
```

PR #255 audit found ~10 agents in yellow-review and yellow-core carrying `memory: project` without this guard. All were documented as "report findings only / Do NOT edit any files" — the expanded write permission existed silently at runtime for every one. Cross-validated by 4 reviewers (adversarial, security, correctness, plugin-contract).

`memory:` also injects the first ~200 lines of the agent's `MEMORY.md` index into context at startup.

### `skills` preloading

Lists skill names (from `skills/` directories) to inject into the subagent's context. Skill name must match the `name:` frontmatter field of the skill file, not the filename. **Subagents do NOT inherit skills from their parent** — the `skills:` list must be explicit. Skills configured with `disable-model-invocation: true` cannot be preloaded.

### `background: true` requires both halves

The `background: true` frontmatter flag declares the agent is concurrent-eligible, but the spawning Task call must also pass `run_in_background: true` to actually run in parallel. One without the other still serializes — the spawn call is the deciding factor. Subagents always run as concurrent tasks within the parent's session regardless of this flag; the flag only affects whether the parent waits for completion.

**Orchestrator prose can falsely claim completeness.** PR #255 review-pr.md Step 5 stated "all always-on review agents declare `background: true`" — in fact 7 of the 8 listed persona agents were missing the flag. Detection pattern: after any migration that adds `background: true` to a set of agents, grep for every agent name cited in orchestrator docs and verify each one has the flag:

```bash
# For each agent name the orchestrator claims is background-enabled:
grep -l 'background: true' plugins/<name>/agents/<agent-name>.md
```

Absence of output is a false claim in the orchestrator prose, not a minor doc inconsistency — it means those agents silently serialize and the stated parallelism guarantee is broken.

### `mcpServers` inline config

Named servers or inline HTTP config:

```yaml
mcpServers:
  notion:
    type: http
    url: https://mcp.notion.com/mcp
```

Honored when agent is invoked via `claude --agent <name>` (added v2.1.117+). In subagent (Task tool) mode, the parent session's MCP servers are inherited.

### `hooks` event mapping

Lifecycle hooks scoped to a subagent. The `Stop` event auto-converts to `SubagentStop` when scoped to a subagent definition. `PreToolUse` and `PostToolUse` work as in session-level hooks; `SubagentStart` cannot block creation.

---

## Plugin subagent restrictions (security boundary)

Three frontmatter fields are **silently dropped** when the agent comes from a plugin (not user/project/managed scope):

- `permissionMode`
- `mcpServers`
- `hooks`

Plugin-shipped agents cannot escalate their own permissions, register their own MCP servers, or attach lifecycle hooks. The fields parse without error but have zero runtime effect. To use them, copy the agent file into `.claude/agents/` (project) or `~/.claude/agents/` (user).

Detection: when reviewing a plugin PR that adds any of these three fields to a `plugins/<name>/agents/*.md` file, flag as a no-op.

---

## Scope Precedence (highest → lowest)

| Priority | Scope | Location |
|---|---|---|
| 1 | Managed (org admin) | Managed settings `.claude/agents/` |
| 2 | CLI-defined | `--agents` JSON flag (session-only) |
| 3 | Project | `.claude/agents/` in project or ancestor |
| 4 | User | `~/.claude/agents/` |
| 5 | Plugin | `plugins/<name>/agents/` |

Name collisions are resolved by precedence. To guarantee the correct agent is invoked from a command file, use the fully-qualified form:

```
subagent_type: "plugin:<plugin-directory-name>:<agent-name>"
```

The `plugin-directory-name` is the directory name (e.g., `yellow-research`), NOT the plugin's `name` field value. Confusing these causes silent invocation failure.

---

## Why This Matters

- **`description` single-line rule:** Folded scalars silently truncate — the parser reads only the first line. This is confirmed parser behavior (GH #10504), not a subtle edge case. Every folded-scalar description passes YAML validation but delivers a broken routing signal.
- **Plugin subagents silently drop three fields:** `permissionMode`, `mcpServers`, and `hooks` are no-ops when shipped from a plugin. Reviewing a plugin PR that adds any of these is reviewing dead frontmatter unless the agent is later moved to user/project scope.
- **`memory:` is a tool expansion:** Adding `memory: project` to an agent advertised as read-only silently grants Read/Write/Edit. The "read-only contract" exists only in the system prompt — the runtime grant is real. Fix: add `disallowedTools: Write, Edit, MultiEdit` to enforce the prose contract at the runtime layer.
- **`memory: true` is invalid:** Boolean form silently does nothing. Use `user`/`project`/`local` strings.
- **`background: true` requires `run_in_background: true` on the spawn call:** Frontmatter alone does not parallelize — the Task call is the deciding factor.
- **Orchestrator prose about `background: true` completeness is not self-verifying:** A command file can state "all N agents are background-enabled" while only a subset actually carry the flag. Grep each named agent after any batch migration to confirm.
- **`disallowedTools` composability:** Prefer `disallowedTools` to restrict a single tool rather than enumerating an entire `tools` allowlist when the goal is "everything except Write/Edit."
- **`isolation: worktree` cleanup:** Worktrees with no changes are cleaned up automatically. Worktrees with changes are left for review — callers must account for this in their orchestration.
- **Scope precedence affects plugin QA:** A project-level `.claude/agents/same-name.md` silently overrides a plugin agent with the same name. Always use qualified `subagent_type` in plugin command files.

---

## When to Apply

- Authoring a new agent `.md` file in any scope.
- Reviewing a PR that adds `memory:`, `background:`, `permissionMode:`, `mcpServers:`, or `hooks:` to a plugin agent — verify the value is in spec AND the field is honored at the agent's scope (not silently dropped).
- Debugging silent delegation failures (wrong agent invoked, routing never fires).
- Choosing between `permissionMode` values for an autonomous agent.
- Adding `isolation: worktree` to agents that must not affect main working tree state.
- Setting `effort` and `maxTurns` to control cost/quality tradeoffs for long-running autonomous agents.

---

## Examples

Minimal agent with explicit tool allowlist:

```yaml
---
name: code-reviewer
description: Reviews code for quality, security, and best practices. Use when the user asks for a code review or wants feedback on their implementation.
tools: Read, Glob, Grep
model: sonnet
---
```

Autonomous agent with isolation, memory, and effort:

```yaml
---
name: rulecheck-agent
description: Runs systematic compliance checks in an isolated worktree. Use when a full codebase scan for rule violations is needed.
model: sonnet
permissionMode: acceptEdits
maxTurns: 500
isolation: worktree
memory: project
effort: high
color: purple
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
skills:
  - coding-standards
---
```

Background scanner with denylist:

```yaml
---
name: dependency-scanner
description: Scans project dependencies for known vulnerabilities. Use when new dependencies are added or a security check is requested.
model: haiku
background: true
effort: low
maxTurns: 10
disallowedTools: Write, Edit
tools: Read, Bash, Glob
---
```

---

## Version Changelog

| Version | Date | Change |
|---|---|---|
| v2.0.28 | 2025-10-27 | Subagents introduced; `model` dynamic selection added |
| v2.0.42 | 2025-11-15 | `agent_id` + `agent_transcript_path` added to SubagentStop hook input |
| v2.0.43 | 2025-11-18 | `permissionMode`, `skills` fields added; SubagentStart hook event added |
| v2.0.x | Late 2025 | `effort`, `maxTurns`, `disallowedTools` added for plugin-shipped agents |
| v2.1.49 | Early 2026 | `isolation: worktree` added |
| v2.1.90+ | 2026-04 | `@mention` typeahead for agents added |
| v2.1.117+ | 2026-04 | `mcpServers` frontmatter honored in `claude --agent <name>` main-thread mode |
| v2.1.119+ | 2026-04 | `permissionMode` honored for built-in agents via `--agent <name>` |

Fields with no deprecation history as of 2026-05-04. Reports of deprecated `deny-tools`, `auto-invoke`, and `extends` fields could not be confirmed against the official changelog — treat as unverified.
