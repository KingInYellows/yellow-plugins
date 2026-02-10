---
name: create-agent-skills
description: Expert guidance for creating Claude Code skills and agents. Use when working with SKILL.md files, authoring new skills, creating slash commands, or designing agent workflows.
argument-hint: "[skill-name|agent-name]"
user-invocable: true
---

# Create Agent Skills

Expert guidance for creating Claude Code skills and agents with proper structure, frontmatter, and best practices.

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
argument-hint: "[optional-args]"
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

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Kebab-case identifier matching filename |
| `description` | Yes | WHAT it does + WHEN to use it (see below) |
| `argument-hint` | No | UI hint for arguments, e.g. `"[branch-name]"` |
| `disable-model-invocation` | No | If `true`, prints markdown only (no LLM call) |
| `user-invocable` | No | If `false`, skill is internal-only (callable by other skills) |
| `allowed-tools` | No | Array of tool names to restrict access |
| `model` | No | Override default model (e.g. `claude-opus-4-6`) |
| `context` | No | `fork` creates isolated subagent context |
| `agent` | No | Agent name to use instead of default |

### Invocation Control Matrix

| Config | User can call? | LLM invoked? | Use case |
|--------|---------------|--------------|----------|
| Default | Yes | Yes | Standard skill |
| `disable-model-invocation: true` | Yes | No | Static reference docs |
| `user-invocable: false` | No | Yes | Internal helper skill |
| Both set | No | No | Private reference docs |

## Dynamic Features

### Arguments Placeholder

Use `$ARGUMENTS` in the skill body to inject user-provided arguments:

```markdown
---
name: explain
argument-hint: "[file-or-concept]"
---

Explain $ARGUMENTS in detail, including purpose and key patterns.
```

Invocation: `/explain authentication.ts` replaces `$ARGUMENTS` with "authentication.ts"

### Shell Command Injection

Use backticks with `!` prefix to inject shell output:

```markdown
Current branch: `!git branch --show-current`
Repository root: `!git rev-parse --show-toplevel`
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
- [ ] Shell commands use `!`command`` syntax (if applicable)
- [ ] Invocation control matches intent
- [ ] Tested with actual invocation

## Anti-Patterns

**Avoid:**

1. **XML tags in body** — Use markdown only
2. **Vague descriptions** — "Helps with git" is not specific
3. **Deep nesting** — Max one level of reference files
4. **Missing invocation control** — Set `user-invocable: false` for internal skills
5. **Too many options** — Skills should be opinionated, not swiss-army knives
6. **Embedding large data** — Use reference files for API schemas, long examples
7. **Dynamic descriptions** — Description is static, body can be dynamic
8. **Over-abstraction** — Prefer specific, focused skills over generic frameworks

## Quick Reference

**Create command:**
```bash
cat > .claude/commands/my-cmd.md << 'EOF'
---
name: my-cmd
description: Does X. Use when Y.
---

# My Command

Instructions here.
EOF
```

**Create skill:**
```bash
mkdir -p .claude/skills/my-skill
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Does X. Use when Y.
---

# My Skill

Instructions here.
EOF
```

**Test invocation:**
```bash
/my-skill arg1 arg2
```
