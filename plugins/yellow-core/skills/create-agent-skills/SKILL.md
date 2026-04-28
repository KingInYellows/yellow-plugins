---
name: create-agent-skills
description: "Expert guidance for creating Claude Code skills and agents. Use when working with SKILL.md files, authoring new skills, creating slash commands, or designing agent workflows."
argument-hint: '[skill-name|agent-name]'
user-invokable: true
---

# Create Agent Skills

Expert guidance for creating Claude Code skills and agents with proper
structure, frontmatter, and best practices.

## Commands vs Skills

**Commands** (`.claude/commands/name.md`):

- Single-file workflows
- Simple, focused tasks
- No supporting files needed
- Examples: `/commit`, `/search`, `/explain`

**Skills** (`.claude/skills/name/SKILL.md`):

- Complex workflows requiring multiple files
- Reference documentation, scripts, templates
- Supporting files in same directory
- Examples: `/workflows:review`, `/git-worktree`

**Both use identical YAML frontmatter format.**

## Standard Format

Every skill/command file has two parts:

1. **YAML Frontmatter** (required)
2. **Markdown Body** with standard headings

```markdown
---
name: skill-name
description: What it does and when to use it. Use when [trigger conditions].
argument-hint: '[optional-args]'
---

# Skill Title

## What It Does

Clear explanation of functionality.

## When to Use

Specific trigger conditions.

## Usage

Command syntax and examples.

## Reference

Additional details, links.
```

## Frontmatter Reference

| Field                      | Required | Description                                                   |
| -------------------------- | -------- | ------------------------------------------------------------- |
| `name`                     | Yes      | Kebab-case identifier matching filename                       |
| `description`              | Yes      | WHAT it does + WHEN to use it (see below)                     |
| `argument-hint`            | No       | UI hint for arguments, e.g. `"[branch-name]"`                 |
| `disable-model-invocation` | No       | If `true`, prints markdown only (no LLM call)                 |
| `user-invokable`           | No       | If `false`, skill is internal-only (callable by other skills) |
| `allowed-tools`            | No       | Array of tool names to restrict access                        |
| `model`                    | No       | Override default model (e.g. `claude-opus-4-6`)               |
| `context`                  | No       | `fork` creates isolated subagent context                      |
| `agent`                    | No       | Agent name to use instead of default                          |

### Invocation Control Matrix

| Config                           | User can call? | LLM invoked? | Use case               |
| -------------------------------- | -------------- | ------------ | ---------------------- |
| Default                          | Yes            | Yes          | Standard skill         |
| `disable-model-invocation: true` | Yes            | No           | Static reference docs  |
| `user-invokable: false`          | No             | Yes          | Internal helper skill  |
| Both set                         | No             | No           | Private reference docs |

## Dynamic Features

### Arguments Placeholder

Use `$ARGUMENTS` in the skill body to inject user-provided arguments:

```markdown
---
name: explain
argument-hint: '[file-or-concept]'
---

Explain $ARGUMENTS in detail, including purpose and key patterns.
```

Invocation: `/explain authentication.ts` replaces `$ARGUMENTS` with
"authentication.ts"

### Shell Command Injection

Use backticks with `!` prefix to inject shell output:

```markdown
Current branch: `!git branch --show-current` Repository root:
`!git rev-parse --show-toplevel`
```

Commands execute during skill load, output injected directly into prompt.

### Subagent Isolation

Use `context: fork` to create isolated subagent:

```yaml
context: fork
```

- Separate conversation context
- Own tool access rules
- Cannot see parent context
- Useful for focused, repeatable workflows

## Progressive Disclosure

**Keep SKILL.md under 500 lines.** Split detailed content into reference files.

```
skills/
  complex-workflow/
    SKILL.md              # Main skill (< 500 lines)
    api-reference.md      # Detailed API docs
    examples.md           # Extended examples
    troubleshooting.md    # Debug guide
```

Reference from main skill:

```markdown
See [API Reference](./api-reference.md) for full method documentation.
```

**Maximum one level deep.** No further subdirectories.

## Effective Descriptions

Description MUST include:

1. **WHAT** the skill does (functionality)
2. **WHEN** to use it (trigger conditions)

**Good Examples:**

```yaml
description: Create isolated git worktrees for parallel development. Use when reviewing PRs, working on multiple features, or when workflows offer worktree option.

description: Generate conventional commits with semantic analysis. Use when creating commits, after staging changes, or when commit message needs improvement.
```

**Bad Examples:**

```yaml
description: Manages worktrees  # Missing WHEN
description: Use for git stuff   # Vague WHAT
description: Advanced git worktree management system with comprehensive support  # Too verbose
```

## Agent Format

Agents live in `agents/<category>/agent-name.md`:

```markdown
---
name: agent-name
description: What the agent does and when it's useful.
model: claude-opus-4-6
---

## Examples

Provide 2-3 concrete examples of when to use this agent.

## System Prompt

You are an expert in [domain]. Your role is to [specific task].

**Key Behaviors:**

- Behavior 1
- Behavior 2
- Behavior 3

**Constraints:**

- Constraint 1
- Constraint 2
```

Categories: `workflow`, `analysis`, `generation`, `review`, `automation`

## Agent Archetypes

Use this table when deciding which frontmatter fields a new agent needs.
"Yes" means the field is required for the archetype to behave correctly;
"Opt" means optional / depends on scope.

| Field | Reviewer | Scanner | Orchestrator | Research | Analyst |
|---|:---:|:---:|:---:|:---:|:---:|
| `name` | Yes | Yes | Yes | Yes | Yes |
| `description` | Yes | Yes | Yes | Yes | Yes |
| `model` (e.g. `inherit`, `haiku`, `opus`) | Yes | Yes | Yes | Yes | Yes |
| `background: true` (parallel spawn) | Yes | Yes | No | Opt | Opt |
| `memory: project` (persistent learning) | Opt | No | Yes | Opt | Opt |
| `skills` (shared conventions) | Opt | Yes (plugin-conventions) | Yes | Opt | Opt |
| `tools` (whitelist) | Read/Grep/Glob/Bash | Read/Grep/Glob/Bash/Write | Task/AskUserQuestion/... | WebSearch/WebFetch/... | Read/Grep/Glob |
| Include `security-fencing` block | Yes | Yes | No | Opt (if scraping content) | Opt |

**Archetype quick guide:**

- **Reviewer** — finds issues in a given diff/file set and reports findings.
  Always spawned in parallel. Never edits files directly.
- **Scanner** — like Reviewer but more systematic across a whole codebase;
  writes findings to structured output files.
- **Orchestrator** — multi-step workflow coordinator that spawns other
  agents via Task. Prompts the user, makes decisions, does not parallelize
  with peers.
- **Research** — investigates an open question by consulting external
  sources (WebSearch, WebFetch, MCP research tools) and/or the codebase.
- **Analyst** — focused investigation of an existing artifact (plan, PR,
  doc). Usually reads only; produces a report.

**Critical:** The `memory:` field takes a **scope string**, NOT a boolean.
Valid values: `memory: user`, `memory: project`, `memory: local`. Writing
`memory: true` is the common wrong form — it may be a no-op.

## Subagent Failure Convention (Output-File Pattern)

When an orchestrator spawns a subagent via the Task tool, the Task tool's
return value is not always reliable for distinguishing partial success
from complete failure (see
[GitHub Issue #24181](https://github.com/anthropics/claude-code/issues/24181)).
A formal structured-failure payload has been proposed upstream
([Issue #25818](https://github.com/anthropics/claude-code/issues/25818))
but is not yet shipped.

**Community-adopted workaround: the output-file convention.**

### For subagent authors

Instruct the subagent (in its system prompt or spawning prompt) to write a
structured result file before exiting:

```json
{
  "agent": "security-sentinel",
  "status": "success",
  "findings": [
    { "severity": "P1", "file": "src/auth.ts", "line": 42, "finding": "..." }
  ]
}
```

Or on failure:

```json
{
  "agent": "security-sentinel",
  "status": "failed",
  "reason": "timeout analyzing src/auth.ts after 60s",
  "partial_findings": []
}
```

Write the file to a path the orchestrator provides. Orchestrators MUST scope
result files to a per-run directory so concurrent sessions cannot collide
(e.g., two review sessions running on different PRs at the same time). The
canonical path is:

```
${TMPDIR:-/tmp}/<run-dir>/agent-result-<agent-name>.json
```

where `<run-dir>` is a unique directory the orchestrator creates at the
start of the run (see orchestrator example below) and passes to each agent
via the spawn prompt.

### For orchestrator authors

1. Create a unique run directory at the start of the workflow:

   ```bash
   # Uses $TMPDIR (or /tmp). Avoids CLAUDE_PLUGIN_DATA — not a
   # documented Claude Code runtime env var; rely on the OS tempdir instead.
   RUN_DIR=$(mktemp -d -t run-XXXXXXXX)
   ```

2. Pass `$RUN_DIR` to each spawned agent so the agent writes to
   `$RUN_DIR/agent-result-<agent-name>.json`.

3. After the Task call returns, read the result file rather than relying on
   the Task return value. Treat `status: "success"` as the only signal that
   the agent completed its work — `status: "failed"`, missing file, or
   invalid JSON all indicate incomplete work that the orchestrator should
   surface.

```bash
RESULT="$RUN_DIR/agent-result-${AGENT_NAME}.json"
if [ ! -f "$RESULT" ]; then
  report_failed "$AGENT_NAME" "result file missing"
elif ! jq -e . "$RESULT" >/dev/null 2>&1; then
  report_failed "$AGENT_NAME" "result file is not valid JSON"
elif ! STATUS=$(jq -er .status "$RESULT" 2>/dev/null); then
  report_failed "$AGENT_NAME" "result file missing required \"status\" field"
elif [ "$STATUS" != "success" ]; then
  REASON=$(jq -r '.reason // "no reason given"' "$RESULT")
  report_failed "$AGENT_NAME" "$REASON"
else
  # process findings from "$RESULT"
  :
fi
```

The two-stage check (`jq -e .` for JSON validity, then `jq -er .status` for
field presence) avoids the misleading "not valid JSON" diagnosis when the
file parses correctly but `.status` is null or absent.

4. Clean up `$RUN_DIR` at the end of the workflow, or leave it in place
   when retaining result files aids post-run debugging.

### Why files and not stdout

Stdout parsing is unreliable — the Task tool may suppress trailing output,
agents may emit unstructured prose alongside the JSON, and context
truncation can drop the final line. Files are durable and can be read
even if the agent crashes mid-execution.

## Creating New Skills

### Step 1: Choose Type

- **Command** if: Single file, < 100 lines, no supporting materials
- **Skill** if: Complex workflow, needs scripts/docs/examples

### Step 2: Create File Structure

Command:

```bash
touch .claude/commands/my-command.md
```

Skill:

```bash
mkdir -p .claude/skills/my-skill
touch .claude/skills/my-skill/SKILL.md
```

### Step 3: Write Frontmatter

Start with minimal viable frontmatter:

```yaml
---
name: my-skill
description: [WHAT] Use when [WHEN].
---
```

Add optional fields only if needed.

### Step 4: Write Body

Use standard headings:

1. **What It Does** — Clear functionality statement
2. **When to Use** — Specific triggers
3. **Usage** — Command syntax, examples
4. **Reference** — Links, details (optional)

### Step 5: Add Reference Files

If SKILL.md approaches 500 lines, extract:

- Detailed examples → `examples.md`
- API docs → `api-reference.md`
- Troubleshooting → `troubleshooting.md`

### Step 6: Test

Test with real usage:

```bash
/my-skill [args]
```

Verify:

- Arguments inject correctly
- Shell commands execute
- Description is discoverable
- Invocation control works as expected

## Audit Checklist

Before submitting a skill:

- [ ] Valid YAML frontmatter (no syntax errors)
- [ ] Description includes WHAT + WHEN
- [ ] Name matches filename (kebab-case)
- [ ] Standard headings used
- [ ] SKILL.md under 500 lines
- [ ] Reference files one level deep (if any)
- [ ] `$ARGUMENTS` used correctly (if applicable)
- [ ] Shell commands use `!command` syntax (if applicable)
- [ ] Invocation control matches intent
- [ ] Tested with actual invocation

## Anti-Patterns

**Avoid:**

1. **XML tags in body** — Use markdown only
2. **Vague descriptions** — "Helps with git" is not specific
3. **Deep nesting** — Max one level of reference files
4. **Missing invocation control** — Set `user-invokable: false` for internal
   skills
5. **Too many options** — Skills should be opinionated, not swiss-army knives
6. **Embedding large data** — Use reference files for API schemas, long examples
7. **Dynamic descriptions** — Description is static, body can be dynamic
8. **Over-abstraction** — Prefer specific, focused skills over generic
   frameworks

## Quick Reference and Plugin Settings

Copy-paste templates for new commands, skills, and the plugin-settings
pattern (`.claude/<plugin-name>.local.md`) live in
[`references/quick-reference.md`](./references/quick-reference.md).
