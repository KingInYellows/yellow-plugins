# Subagent Frontmatter Reference (Claude Code, as of 2026-05-04)

**Date:** 2026-05-04
**Sources:** Official Anthropic docs (code.claude.com, docs.anthropic.com), Claude Code TypeScript SDK reference, official changelog, GitHub issues on anthropics/claude-code, real-world plugin repos

## Summary

Subagent `.md` files in Claude Code use a YAML frontmatter block (delimited by `---`) to declare identity, capabilities, model selection, permissions, and runtime behavior. The Markdown body below the frontmatter becomes the subagent's system prompt verbatim. The frontmatter parser is strict about field names: only recognized keys are acted upon; unknown keys are silently ignored unless they conflict with YAML parsing itself. Only `name` and `description` are required; all other fields are optional. Invalid YAML (malformed scalars, bad indentation) prevents the file from loading; invalid field _values_ typically cause the field to be ignored or the agent to fail to spawn.

---

## Required Fields

### `name`

| Attribute | Value |
|-----------|-------|
| Type | `string` |
| Required | Yes |
| Pattern | Lowercase letters (`a-z`), digits (`0-9`), and hyphens (`-`) only. No spaces, no uppercase, no underscores. |
| Max length | Not officially stated; community convention and examples use 1–64 characters. |
| Uniqueness | Must be unique within its discovery scope. Name collisions across scopes are resolved by precedence (see Precedence section). |
| Reserved words | Cannot start with a reserved prefix (exact list not published, but avoid `anthropic`, `claude`). |

**Runtime behavior:** The name is the identifier used in the `/agents` UI, in Task tool `subagent_type` references, in `--agent <name>` CLI invocations, and in `@mention` typeahead (introduced April 2026, v2.1.90+). The filename of the `.md` file does not need to match the `name` field, but by strong convention it should (e.g., `name: code-reviewer` in `code-reviewer.md`).

**Plugin namespacing:** When a plugin ships an agent, the agent is accessible in the Task tool as `plugin:<plugin-dir>:<name>` (qualified form) or as just `<name>` if unambiguous. Bare `<name>` resolves using scope precedence; specify the qualified form in command files where ambiguity is possible to ensure the correct agent is invoked.

---

### `description`

| Attribute | Value |
|-----------|-------|
| Type | `string` (single-line) |
| Required | Yes |
| Format | Must be a single-line string. Do NOT use YAML folded scalars (`description: >`) or YAML literal block scalars (`description: \|`) or multi-line single-quoted strings. |
| Length | No official hard limit; community practice keeps it under ~300 characters for automatic routing accuracy. |

**Runtime behavior:** The description serves two purposes simultaneously:

1. **Delegation routing:** Claude reads the description to decide whether to delegate a task to this subagent. Descriptions that include explicit trigger conditions ("Use when the user asks to…", "Delegate here for all X tasks") produce more reliable automatic invocation than vague descriptions.
2. **UI display:** Shown in the `/agents` list and in the task list alongside the agent's color.

**The "Use when..." trigger clause convention:** Although not enforced by the parser, the community has converged on a convention of beginning or ending the description with a trigger clause: `"Use when the user asks to review code for security vulnerabilities"`. This maximizes correct automatic delegation. The description is matched semantically (not lexically) against the task at hand.

**Why folded scalars silently truncate:** Claude Code's frontmatter parser reads only the first line of the scalar value when a YAML folded (`>`) or literal block (`|`) scalar is encountered. The continuation lines are discarded without warning, producing a truncated description. This is a known parser limitation documented in multiple GitHub issues (anthropics/claude-code #10504). The same truncation occurs with multi-line single-quoted strings that wrap to the next line. Always keep `description:` on a single line with the value inline.

**Examples block convention (observed in real-world agents):** Some description strings embed XML-style `<example>` blocks directly inline to improve automatic routing. This is observed practice (see home-assistant/core agents), not an officially documented feature. These examples are part of the description string and contribute to routing context.

```yaml
# Good — single line with trigger clause
description: Reviews code changes for security vulnerabilities. Use when the user asks to audit, scan, or review code for security issues.

# Bad — folded scalar, silently truncates to "Reviews code changes"
description: >
  Reviews code changes for security vulnerabilities.
  Use when the user asks to audit code.

# Bad — literal block, same truncation problem
description: |
  Reviews code changes.
  Use when: code review requested.
```

---

## Optional Fields

### `tools`

| Attribute | Value |
|-----------|-------|
| Type | Comma-separated string OR YAML list |
| Default | All tools inherited from the parent session if omitted |
| Format | `tools: Read, Grep, Glob, Bash` OR YAML list form `tools:\n  - Read\n  - Grep` |

**Semantics:** When specified, this is an explicit **allowlist** — the subagent can only use the listed tools. Tools not in the list are unavailable, even if the parent session has them. When omitted, all tools available to the parent conversation are available.

**MCP tool naming:** MCP tools follow the pattern `mcp__plugin_<pluginName>_<serverName>__<toolName>`. For example: `mcp__plugin_yellow-research_perplexity__perplexity_research`. The double underscore (`__`) separates the server prefix from the tool name. In frontmatter you must use the exact fully-qualified MCP tool name:

```yaml
tools: mcp__meigen__generate_image, Read, Grep
```

**Built-in tool names (as of May 2026):** `Read`, `Write`, `Edit`, `MultiEdit`, `Bash`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Task`, `TodoRead`, `TodoWrite`, `NotebookRead`, `NotebookEdit`, `exit_plan_mode`, `AskUserQuestion`. Note: on native macOS/Linux builds (v2.1.113+), `Glob` and `Grep` are provided as `bfs`/`ugrep` through `Bash` rather than standalone tools, but you can still reference them by name in `tools` — the backend substitution is transparent.

**Bash specifiers for fine-grained tool control:** You can restrict Bash to specific command prefixes: `Bash(git *)`, `Bash(npm:*)`, `Bash(test:*)`. This allows a subagent to run `git` commands but not arbitrary shell.

**`ToolSearch` deferred-tool pattern:** Commands and agents that use MCP tools must include `ToolSearch` in their `tools` (or `allowed-tools` for SKILL.md files) so that the tool schemas can be resolved at runtime. Without `ToolSearch`, calling a deferred tool fails with `InputValidationError`.

**Subagents cannot spawn subagents:** Do NOT include `Task` in a subagent's `tools` array. Subagents cannot invoke other subagents via the Task tool. Only the main conversation (or a command) can spawn subagents. Attempting to include `Task` will either be silently ignored or cause the spawn to fail.

---

### `disallowedTools`

| Attribute | Value |
|-----------|-------|
| Type | Comma-separated string OR YAML list |
| Default | None (no tools denied beyond what `tools` already restricts) |

**Semantics:** A denylist. Removes specific tools from the agent's effective tool set. Applied after the `tools` allowlist is computed. Useful when you want to inherit all tools but deny a specific few:

```yaml
# Inherit everything except Write and Edit (read-only agent)
disallowedTools: Write, Edit

# Deny specific Bash patterns
disallowedTools:
  - "Bash(rm -rf*)"
  - "Bash(git push*)"
```

When both `tools` and `disallowedTools` are specified, `tools` sets the allowlist and `disallowedTools` further removes from it.

---

### `model`

| Attribute | Value |
|-----------|-------|
| Type | `string` (enum alias or full model ID) |
| Default | `inherit` (uses the parent session's active model) |

**Valid values:**

| Value | Meaning |
|-------|---------|
| `sonnet` | Latest Claude Sonnet model (currently maps to `claude-sonnet-4-6`) |
| `opus` | Latest Claude Opus model (currently maps to `claude-opus-4-7` or similar) |
| `haiku` | Latest Claude Haiku model (currently maps to `claude-haiku-4-5-20251001` or similar) |
| `inherit` | Use the same model as the parent conversation (default behavior; explicit `inherit` and omitting the field are equivalent) |
| Full model ID | Any concrete Anthropic API model ID, e.g., `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |

**Override precedence:** The `model` field in frontmatter can be overridden by:
1. The environment variable `CLAUDE_CODE_SUBAGENT_MODEL` (takes precedence over frontmatter)
2. The parent session's `--model` CLI flag (behavior depends on version; in recent versions `CLAUDE_CODE_SUBAGENT_MODEL` is the authoritative override)
3. Frontmatter `model` field
4. Default: `inherit`

**Plugin subagents:** The `model` field is honored for plugin-shipped agents (added in the same release as `effort`, `maxTurns`, and `disallowedTools` for plugin agents, v2.0.x).

**Note on alias-to-ID mapping:** The concrete model IDs that aliases like `sonnet`, `opus`, `haiku` resolve to are updated as new model releases occur. The aliases always point to the latest recommended model in that family. For reproducible behavior in production, use full model IDs rather than aliases.

---

### `permissionMode`

| Attribute | Value |
|-----------|-------|
| Type | `string` (enum) |
| Default | Inherits from parent session |
| Plugin agents | Ignored for plugin subagents |

**Valid values:**

| Value | Behavior |
|-------|----------|
| `default` | Standard permission checking — prompts for approval before risky actions |
| `acceptEdits` | Auto-accepts file edits and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`) for paths in working directory or `additionalDirectories` |
| `auto` | Background classifier reviews commands; auto-approves most, prompts on risky ones |
| `dontAsk` | Auto-denies permission prompts; only pre-approved (explicitly allowed) tools run |
| `bypassPermissions` | Skips all permission prompts. Protected paths (`.git`, `.claude`, `.vscode`, `.idea`, `.husky`) still prompt, except `.claude/commands`, `.claude/agents`, `.claude/skills` |
| `plan` | Read-only exploration mode; no file edits or command execution |

**Inheritance rules:**
- If the parent uses `bypassPermissions` or `acceptEdits`, that takes precedence and the subagent's `permissionMode` is ignored.
- If the parent uses `auto`, the subagent inherits `auto` and its `permissionMode` frontmatter is ignored.
- In all other cases, the subagent's `permissionMode` frontmatter overrides the parent's mode.

**Added:** v2.0.43 (November 18, 2025)

---

### `maxTurns`

| Attribute | Value |
|-----------|-------|
| Type | `number` (positive integer) |
| Default | No limit (or session default) |

**Semantics:** Caps the number of agentic turns (API round-trips) the subagent may take before stopping. Prevents runaway agents. A value of `0` or omitting the field means no explicit cap is imposed beyond session defaults.

Real-world examples: `maxTurns: 25` (game prototyper), `maxTurns: 30` (typical complex agent), `maxTurns: 500` (rulecheck-agent designed for extended autonomous operation).

---

### `skills`

| Attribute | Value |
|-----------|-------|
| Type | YAML list of skill names OR comma-separated string |
| Default | No preloaded skills |

**Semantics:** Declares a list of skill names (from `skills/` directories) to preload into the subagent's context. Skills inject additional instructions or knowledge into the system prompt. The skill name is the short name matching the skill's `name:` frontmatter field.

```yaml
skills:
  - code-review-standards
  - security-patterns
  - nw-design-patterns
```

**Added:** `skills` frontmatter field for subagents added in v2.0.43 (November 18, 2025).

---

### `mcpServers`

| Attribute | Value |
|-----------|-------|
| Type | YAML list of server name strings OR inline MCP server configs |
| Default | Inherits MCP servers from session |

**Semantics:** Specifies which MCP servers the subagent can access. Can be provided as a list of named servers (by their registered name) or as inline config objects for servers not registered globally.

**Format — named server:**
```yaml
mcpServers:
  - sentry
  - github
```

**Format — inline config (HTTP):**
```yaml
mcpServers:
  notion:
    type: http
    url: https://mcp.notion.com/mcp
  github:
    type: http
    url: https://api.githubcopilot.com/mcp
```

**Honored in main-thread mode:** `mcpServers` in frontmatter is honored when the agent is invoked as a main-thread agent via `claude --agent <name>` (added v2.1.117+).

**Note:** MCP tool names available to the subagent via `mcpServers` follow the naming pattern `mcp__<serverName>__<toolName>`. The server name in the prefix matches the key used to register the server.

---

### `hooks`

| Attribute | Value |
|-----------|-------|
| Type | YAML mapping (event name → hook definition) |
| Default | No subagent-scoped hooks |

**Semantics:** Allows lifecycle hooks scoped to this specific subagent definition. Hook events available for subagents include `PreToolUse` and `PostToolUse`. At session level, `SubagentStart` and `SubagentStop` fire for any subagent spawn/completion.

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: /path/to/validate-bash.sh
```

**SubagentStart hook output:** A `SubagentStart` hook can inject additional context into the subagent by returning `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": "..."}}`. SubagentStart hooks cannot block subagent creation.

**SubagentStop hook:** Fires when the subagent finishes. Receives `agent_id` and `agent_transcript_path` fields in its input (added v2.0.42, November 15, 2025).

---

### `memory`

| Attribute | Value |
|-----------|-------|
| Type | `string` (enum) |
| Default | No persistent memory |
| Valid values | `user`, `project`, `local` |

**Semantics:** Enables persistent memory for the subagent across sessions. A `MEMORY.md` file is maintained in the corresponding directory.

| Value | Storage Location | VCS-trackable |
|-------|-----------------|---------------|
| `user` | `~/.claude/agent-memory/<name>/` | No |
| `project` | `.claude/agent-memory/<name>/` | Yes |
| `local` | `.claude/agent-memory-local/<name>/` | No |

When `memory` is set, the subagent reads and updates its `MEMORY.md` file automatically, allowing it to accumulate knowledge across separate sessions.

---

### `background`

| Attribute | Value |
|-----------|-------|
| Type | `boolean` |
| Default | `false` |
| Valid values | `true`, `false` |

**Semantics:** When `true`, the subagent runs as a non-blocking background task when invoked. The main conversation does not wait for the subagent to complete before continuing. Useful for fire-and-forget operations like logging, notifications, or parallel analysis.

---

### `effort`

| Attribute | Value |
|-----------|-------|
| Type | `string` (enum) OR `number` (integer) |
| Default | Inherits from session |
| Valid string values | `low`, `medium`, `high`, `xhigh`, `max` |

**Semantics:** Sets the reasoning effort level for this subagent when it runs. Overrides the session-level effort setting. Available levels depend on the model — not all models support all effort levels. Numeric values are also accepted by the SDK (maps to internal token budget).

| Value | Effect |
|-------|--------|
| `low` | Minimal thinking tokens, fastest response, lowest cost |
| `medium` | Balanced reasoning (typical default) |
| `high` | More extended thinking, better on complex problems |
| `xhigh` | Extended high reasoning |
| `max` | Maximum thinking tokens available for the model |

**Added:** `effort` frontmatter support added in the same batch as `maxTurns` and `disallowedTools` for plugin agents.

---

### `isolation`

| Attribute | Value |
|-----------|-------|
| Type | `string` (enum) |
| Default | No isolation (shares working directory with main session) |
| Valid values | `worktree` |

**Semantics:** `isolation: worktree` runs the subagent in a temporary git worktree — an isolated copy of the repository. The worktree is created before the subagent starts and automatically cleaned up if the subagent makes no changes. If changes are made, the worktree branch can be reviewed and merged.

Use cases: safe parallel code changes, prototype work that may be discarded, preventing the subagent from affecting main working tree state.

**Added:** v2.1.49 (`isolation: worktree` support). Documented in changelog and GitHub issue #27023.

**Note on undocumented variants:** The EXA deep research report mentions `strict`, `shared`, and `fork` as isolation values. These do NOT appear in the official Anthropic docs or the TypeScript SDK reference as of May 2026. Only `worktree` is officially documented. Do not use other values.

---

### `color`

| Attribute | Value |
|-----------|-------|
| Type | `string` (named color enum) |
| Default | No color (uses system default in UI) |
| Valid values | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan` |

**Semantics:** Sets the display color for the subagent in the task list and transcript UI. Used purely for visual distinction — has no effect on behavior.

**Format:** Named color strings only. Hex codes (e.g., `#00ccff`) appear in community examples and the SDK documentation but are NOT listed in the official frontmatter reference table. The official docs list exactly 8 named colors: `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. The GitHub issue #19292 also proposes adding `magenta` (not in the official table as of May 2026). The community issue report notes that `color` was undocumented for an extended period and was only added to the official docs table after a user bug report. Treat hex codes as "observed but unofficially documented" — they may work but are not in the official spec.

**UI surface:** Appears in the agent icon/badge in the task list, the subagent transcript header, and the `/agents` management UI.

---

### `initialPrompt`

| Attribute | Value |
|-----------|-------|
| Type | `string` |
| Default | None |

**Semantics:** A string that is automatically submitted as the first user turn when the subagent starts. Allows pre-seeding the subagent's first action without requiring the caller to pass an initial message. Only relevant when invoking the agent via `claude --agent <name>` (main-thread mode).

---

## Fields Documented Only in the TypeScript SDK (`AgentDefinition`)

These fields appear in the official TypeScript SDK `AgentDefinition` type and/or the `--agents` JSON flag documentation. They are supported in programmatic/SDK agent definitions and via the `--agents` CLI flag. Their behavior in file-based YAML frontmatter is either confirmed or likely — the `--agents` flag docs explicitly state it "accepts JSON with the same frontmatter fields."

### `criticalSystemReminder_EXPERIMENTAL`

| Attribute | Value |
|-----------|-------|
| Type | `string` |
| Status | Experimental — name contains `_EXPERIMENTAL` suffix |

**Semantics:** A critical reminder string appended to the subagent's system prompt. The `_EXPERIMENTAL` suffix signals that this API may change or be removed. Use with caution and avoid relying on it in production.

---

## Advanced / Observed-but-Unofficial Fields

The following fields have been observed in real-world public repositories but do NOT appear in the official Anthropic documentation's frontmatter table. They are annotated accordingly.

### `priority` — observed but unofficial

Seen in a small number of community agents. Suggested semantics: integer controlling routing precedence when multiple agents match a task. Not in official docs as of May 2026. Do not rely on it.

### `linked-from-skills` — observed but unofficial

Seen in `popup-studio-ai/bkit-claude-code` agents. Appears to be a plugin-internal cross-reference metadata field, not parsed by Claude Code's core runtime. Community/plugin convention only.

### `imports` — observed but unofficial

Seen in `popup-studio-ai/bkit-claude-code` design-validator.md. Appears to be a plugin framework extension to inline-include content from other files. Not in official spec.

### `context: fork` — observed but unofficial

Seen alongside `mergeResult: false` in bkit-claude-code plugin agents. Appears to be a plugin-level extension, not an official Claude Code frontmatter field.

### `readonly: true` — observed but unofficial

Seen in `streamlit/streamlit` reviewing-local-changes.md. Appears to be a semantic shorthand for read-only mode. Not in official docs — when read-only behavior is needed, use `disallowedTools: Write, Edit` or `permissionMode: plan` instead.

### `voiceId`, `voice:` mapping — observed but unofficial

Seen in `danielmiessler/Personal_AI_Infrastructure` agents. Custom extension for voice/TTS integration. Not parsed by Claude Code's core runtime.

### `version`, `author`, `license`, `metadata` — observed but unofficial

Seen in various plugin and community agents (e.g., NousResearch/hermes-agent). These are informational metadata fields. The Claude Code runtime ignores them. The plugin manifest (`plugin.json`) uses `version`, `author`, `license` but these are separate from the agent frontmatter spec.

---

## Format and Parsing Rules

### File structure

```
---
name: agent-name
description: Single-line description of what this agent does and when to use it.
tools: Read, Grep, Glob
model: sonnet
color: blue
---

# Agent Name (this heading is optional — the whole body is the system prompt)

Your system prompt goes here. This Markdown content is passed verbatim
to the subagent as its system prompt.
```

### YAML delimiters

The frontmatter block must begin and end with `---` on their own lines. The opening `---` must be the very first line of the file (no BOM, no blank lines before it).

### Comma-separated vs YAML list for `tools` and `disallowedTools`

Both forms are accepted. The comma-separated string form is more common in documentation examples:

```yaml
tools: Read, Grep, Glob, Bash
```

The YAML list form also works and is more readable for long lists:

```yaml
tools:
  - Read
  - Grep
  - Glob
  - Bash
```

Do not mix forms in the same field.

### Single-line description requirement

The `description` field must be a single inline YAML string. The following patterns silently truncate the description:

```yaml
# WRONG — folded scalar, truncates to first line
description: >
  Use when the user asks about security.
  Also handles vulnerability scanning.

# WRONG — literal block scalar, same problem
description: |
  Use when security review needed.

# WRONG — multi-line single-quoted string that wraps
description: 'Use when the user asks about security
  and vulnerability scanning.'

# CORRECT — inline single line (quotes optional unless special chars)
description: Use when the user asks about security or needs vulnerability scanning.

# CORRECT — double-quoted for strings with colons or special chars
description: "Use when: security review, audit, or vulnerability scan is requested."
```

### LF line endings

All agent `.md` files must use LF line endings, not CRLF. On WSL2 or Windows environments where the Write tool creates files with CRLF, run `sed -i 's/\r$//' <file>` after creating the file to normalize endings. CRLF can cause frontmatter parsing failures.

### Naming rules for `name`

- Lowercase letters (`a-z`), digits (`0-9`), hyphens (`-`) only
- No spaces, no underscores, no uppercase letters
- Should not start or end with a hyphen
- Must be unique within its scope (project, user, plugin)
- Convention: use kebab-case matching the filename minus `.md`

### File location and filename

The filename does not need to match the `name` field, but must end in `.md`. By convention, `name: code-reviewer` lives in `code-reviewer.md`. The file must be placed in an `agents/` directory within the appropriate scope location.

### System prompt (body)

Everything after the closing `---` of the frontmatter is the system prompt. This is passed verbatim to the subagent — it does not receive the full Claude Code system prompt, only this body plus basic environment details (working directory). The body can be any Markdown: headings, lists, code blocks are all valid and render as part of the instructions.

---

## Triggering and Discovery

### Automatic delegation

When Claude is handling a task, it evaluates all loaded subagent descriptions to determine if any match the current task. Matching is semantic (not literal keyword matching). A subagent is selected when its description accurately captures the task type and the task would benefit from delegation (context isolation, specialized behavior).

### Manual invocation

Subagents can always be invoked explicitly:
- `@agent-name` in chat (@ mention typeahead, added April 2026 v2.1.90+)
- `claude --agent <name>` CLI (runs agent as main-thread, not subagent)
- Via the Task tool: `subagent_type: "agent-name"` or `subagent_type: "plugin:plugin-dir:agent-name"`

### Loading and refresh

Subagents are loaded at session start. If you add or modify a `.md` file while a session is running:
- Run `/agents` command to reload immediately, OR
- Restart the session

### `proactive` / auto-invocation description keywords

The word "Proactively" in the description is a documented pattern that signals the agent should be considered for automatic invocation after relevant operations (e.g., "Proactively review JS/TS files and offer fixes before committing"). This is a prompt-level convention — there is no `proactive:` boolean frontmatter field in the official spec as of May 2026. The EXA research report mentions a `proactive` field — this is not confirmed in official docs and should be treated as unverified.

### `initialPrompt` and main-thread invocation

When using `claude --agent <name>`, the `initialPrompt` frontmatter field auto-submits a first turn. In subagent (Task tool) mode, the initial message is supplied by the parent.

---

## Precedence and Namespacing

### Scope hierarchy

Definitions are loaded from all applicable scopes. When multiple definitions share the same `name`, the following precedence applies (highest to lowest):

| Priority | Scope | Location |
|----------|-------|----------|
| 1 (highest) | Managed (organization admin) | Managed settings directory / `.claude/agents/` in managed settings |
| 2 | CLI-defined | `--agents` JSON flag (session-only, not persisted) |
| 3 | Project | `.claude/agents/` in current project or ancestor directories |
| 4 | User | `~/.claude/agents/` |
| 5 (lowest) | Plugin | `plugins/<name>/agents/` or plugin-installed agents |

**Programmatic vs filesystem:** Agents defined programmatically (SDK `agents` parameter or `--agents` flag) take precedence over filesystem-based agents with the same name.

**Plugin agents:** Plugin agents appear in `/agents` alongside custom agents but have the lowest precedence. Plugin agents can be referenced by unqualified name (if unique) or qualified name `plugin:<plugin-dir>:<name>`.

### Qualified `subagent_type` in command files

When spawning agents from command files or other agents using the Task tool, always use the fully-qualified form when there is any risk of name collision:

```
subagent_type: "plugin:yellow-research:ceramic-researcher"
subagent_type: "code-reviewer"  # unqualified — OK only if unique in scope
```

The fully-qualified form is `plugin:<plugin-directory-name>:<agent-name>` where `plugin-directory-name` is the directory name of the plugin (e.g., `yellow-research`), not the plugin's `name` field. This distinction matters: using the wrong identifier causes silent invocation failure or invocation of the wrong agent.

### Managed agents

Administrators deploy managed subagents by placing `.md` files in `.claude/agents/` inside the managed settings directory. Managed agents use identical frontmatter format and override project/user agents with the same name. The `permissionMode` field is honored for managed agents (unlike plugin agents, where it is ignored).

---

## Examples

### Example 1 — Minimal valid agent

```yaml
---
name: code-reviewer
description: Reviews code for quality, security, and best practices. Use when the user asks for a code review or wants feedback on their implementation.
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the provided code and return
specific, actionable feedback on quality, security, and best practices.
Focus on:
- Security vulnerabilities (injection, auth, secrets in code)
- Performance issues
- Maintainability and readability

Return your findings as a numbered list with file:line references.
```

### Example 2 — Full-featured agent with isolation and persistent memory

```yaml
---
name: rulecheck-agent
description: Autonomous code quality agent that scans for rule violations, fixes them in an isolated worktree, creates a PR, and updates memory with findings. Use when a systematic compliance check is needed.
model: sonnet
permissionMode: acceptEdits
maxTurns: 500
isolation: worktree
memory: project
color: purple
effort: high
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
skills:
  - coding-standards
  - security-patterns
---

You are an autonomous code quality agent. Your working directory MUST
contain `.claude/worktrees/` in the path — if it does not, stop immediately.

[...system prompt continues...]
```

### Example 3 — Plugin agent with MCP server access

```yaml
---
name: sentry-mcp
description: Sentry error tracking and performance monitoring agent. Use when the user asks about errors, exceptions, issues, stack traces, performance, traces, releases, or provides a Sentry URL.
mcpServers:
  - sentry
model: haiku
color: cyan
---

You are a Sentry specialist. Use the Sentry MCP tools to search for issues,
analyze stack traces, and provide actionable debugging recommendations.
```

### Example 4 — Background agent with explicit effort

```yaml
---
name: dependency-scanner
description: Scans project dependencies for known vulnerabilities in the background. Use when the user adds new dependencies or asks about security of dependencies.
model: haiku
background: true
effort: low
maxTurns: 10
tools: Read, Bash(npm audit:*), Glob
color: yellow
---

Scan the project's dependencies for known security vulnerabilities.
Run `npm audit` or equivalent for the detected package manager.
Return a summary of critical and high-severity findings only.
```

---

## Field Quick-Reference Table

| Field | Required | Type | Default | Official? |
|-------|----------|------|---------|-----------|
| `name` | Yes | `string` (kebab-case) | — | Official |
| `description` | Yes | `string` (single-line) | — | Official |
| `tools` | No | comma-string or list | inherit all | Official |
| `disallowedTools` | No | comma-string or list | none | Official |
| `model` | No | string enum or model ID | `inherit` | Official |
| `permissionMode` | No | string enum | inherit from parent | Official |
| `maxTurns` | No | integer | no limit | Official |
| `skills` | No | list of skill names | none | Official |
| `mcpServers` | No | list or mapping | none | Official |
| `hooks` | No | event → handler mapping | none | Official |
| `memory` | No | `user`/`project`/`local` | none | Official |
| `background` | No | `boolean` | `false` | Official |
| `effort` | No | `low`/`medium`/`high`/`xhigh`/`max` or integer | inherit | Official |
| `isolation` | No | `worktree` (only valid value) | none | Official |
| `color` | No | `red`/`blue`/`green`/`yellow`/`purple`/`orange`/`pink`/`cyan` | none | Official |
| `initialPrompt` | No | `string` | none | Official |
| `criticalSystemReminder_EXPERIMENTAL` | No | `string` | none | Official (experimental) |
| `priority` | No | integer | — | Observed, unofficial |
| `version`, `author`, `license` | No | string | — | Ignored (plugin manifest fields) |

---

## Changelog: Recently Added and Removed Fields

| Version | Date | Change |
|---------|------|--------|
| v2.0.28 | October 27, 2025 | Subagents introduced; `model` dynamic selection added |
| v2.0.42 | November 15, 2025 | `agent_id` and `agent_transcript_path` added to `SubagentStop` hook input |
| v2.0.43 | November 18, 2025 | `permissionMode` field added; `skills` frontmatter field added; `SubagentStart` hook event added |
| v2.0.x  | Late 2025 | `effort`, `maxTurns`, `disallowedTools` frontmatter support added for plugin-shipped agents |
| v2.1.49 | Early 2026 | `isolation: worktree` added |
| v2.1.90+ | April 2026 | `@mention` typeahead for agents; `mcpServers` in frontmatter honored when using `claude --agent <name>` (v2.1.117+); `permissionMode` honored for built-in agents via `--agent <name>` (v2.1.119+) |

**Fields with no deprecation history found** as of May 4, 2026 in official sources. The EXA report mentions `deny-tools` (deprecated v2.1.110), `auto-invoke` (deprecated v2.1.112, replaced by `proactive`), and `extends` (removed v2.1.115) — these could not be confirmed against the official changelog and should be treated as unverified. The official docs do not mention any deprecated frontmatter fields.

---

## Sources

1. [Create custom subagents — code.claude.com](https://code.claude.com/docs/en/subagents) — Primary official reference for all frontmatter fields including the complete field table, color values, effort values, permissionMode values, and isolation. Accessed 2026-05-04.

2. [Create custom subagents — docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/sub-agents) — Anthropic-hosted mirror of official docs. Confirms `--agents` JSON field list. Accessed 2026-05-04.

3. [Subagents in the SDK — code.claude.com](https://code.claude.com/docs/en/agent-sdk/subagents) — SDK programmatic agent fields including `memory`, `skills`, `cleanupPeriodDays`. Accessed 2026-05-04.

4. [Agent SDK reference — TypeScript — code.claude.com](https://code.claude.com/docs/en/agent-sdk/typescript) — Authoritative `AgentDefinition` TypeScript type confirming all SDK-level fields including `criticalSystemReminder_EXPERIMENTAL`. Accessed 2026-05-04.

5. [Hooks reference — code.claude.com](https://code.claude.com/docs/en/hooks) — SubagentStart/SubagentStop hook events, hook input/output schemas, `additionalContext` field. Accessed 2026-05-04.

6. [Changelog — code.claude.com](https://code.claude.com/docs/en/changelog) — Version history confirming when `permissionMode`, `skills`, `effort`, `maxTurns`, `isolation` were added. Accessed 2026-05-04.

7. [Choose a permission mode — code.claude.com](https://code.claude.com/docs/en/permission-modes) — Full permissionMode enum values and inheritance semantics. Accessed 2026-05-04.

8. [GitHub issue #19292 — anthropics/claude-code](https://github.com/anthropics/claude-code/issues/19292) — `color` field undocumented bug report; reveals accepted color values `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`. Accessed 2026-05-04.

9. [GitHub issue #27023 — anthropics/claude-code](https://github.com/anthropics/claude-code/issues/27023) — `isolation: worktree` missing from docs; confirms v2.1.49 introduction. Accessed 2026-05-04.

10. [GitHub issue #10504 — anthropics/claude-code](https://github.com/anthropics/claude-code/issues/10504) — Description field YAML parsing issues; confirms folded scalar truncation behavior. Accessed 2026-05-04.

11. [claude-howto/04-subagents — luongnv89/claude-howto](https://github.com/luongnv89/claude-howto/blob/main/04-subagents/README.md) — Community reference showing full frontmatter including `background`, `effort`, `isolation`, `initialPrompt`, and `hooks` syntax with version annotations. Accessed 2026-05-04.

12. Real-world agent examples from: [home-assistant/core](https://github.com/home-assistant/core/tree/dev/.claude/agents), [n8n-io/n8n](https://github.com/n8n-io/n8n/tree/master/.claude/plugins/n8n/agents), [streamlit/streamlit](https://github.com/streamlit/streamlit/tree/develop/.claude/agents), [coleam00/Archon](https://github.com/coleam00/Archon/tree/dev/.claude/agents), [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp/tree/main/plugins/sentry-mcp/agents), [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure/tree/main/Releases/v4.0.3/.claude/agents). Accessed 2026-05-04.

13. [perplexity_research] — Source skipped (unavailable — API quota exceeded).
