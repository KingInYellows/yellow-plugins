---
title: 'Skill and Agent Frontmatter Attribute Name and Format Requirements'
category: code-quality
tags: [claude-code, skill, agent, frontmatter, yaml, plugin-authoring]
module: plugins (all)
symptom:
  "VS Code diagnostics: 'Attribute user-invocable is not supported' and
  'Unexpected indentation' on SKILL.md and agent .md files"
root_cause:
  'Wrong attribute spelling (user-invocable vs user-invokable) and unsupported
  YAML folded scalar format in descriptions'
date: 2026-02-17
pr: '#23, #69'
---

# Skill and Agent Frontmatter Attribute Name and Format Requirements

## Problem

VS Code diagnostics on SKILL.md files showed two categories of errors:

```
✘ [Line 4:1] Unexpected indentation
⚠ [Line 4:3] Attribute 'Shared conventions for CI analysis...' is not supported
⚠ [Line 7:1] Attribute 'user-invocable' is not supported in skill files.
  Supported: argument-hint, compatibility, description, disable-model-invocation,
  license, metadata, name, user-invokable.
```

All 13 SKILL.md files across all 10 plugins were affected.

## Root Cause

Two distinct issues:

### 1. Wrong attribute name: `user-invocable` vs `user-invokable`

Claude Code's supported attribute is spelled `user-invokable` (with **k**), not
`user-invocable` (with **c**). The typo propagated across all plugins because
the first skill was written with `user-invocable` and all subsequent skills
copied the pattern.

### 2. YAML folded scalars not supported

Claude Code's frontmatter parser does **not** support YAML folded scalar syntax
(`>`). It uses a simple line-by-line parser, not a full YAML parser.

**Broken format:**

```yaml
---
name: my-skill
description: >
  Multi-line description that spans several lines using YAML folded scalar.
user-invokable: false
---
```

Each continuation line (`Multi-line description...`, `several lines...`) is
parsed as a separate invalid attribute.

**Working format:**

```yaml
---
name: my-skill
description: Multi-line description that spans several lines, all on one line.
user-invokable: false
---
```

## Solution

For every SKILL.md file:

1. **Rename attribute:** `user-invocable` → `user-invokable`
2. **Flatten description:** Convert `description: >` multi-line to a single-line
   `description: ...`
3. **Update body text:** Change prose references from "user-invocable" to
   "user-invokable" for consistency

### Supported Frontmatter Attributes (as of 2026-02)

```
argument-hint, compatibility, description, disable-model-invocation,
license, metadata, name, user-invokable
```

### Grep to find violations

```bash
# Wrong attribute name
grep -r 'user-invocable' plugins/*/skills/*/SKILL.md

# Multi-line descriptions
grep -r '^description: >$' plugins/*/skills/*/SKILL.md
```

## Scope of Fix

13 SKILL.md files across 10 plugins, plus 1 CLAUDE.md with a prose reference:

| Plugin              | Files Fixed                              |
| ------------------- | ---------------------------------------- |
| yellow-browser-test | agent-browser-patterns, test-conventions |
| yellow-chatprd      | chatprd-conventions                      |
| yellow-ci           | ci-conventions, diagnose-ci              |
| yellow-core         | create-agent-skills, git-worktree        |
| yellow-debt         | debt-conventions                         |
| yellow-devin        | devin-workflows                          |
| yellow-linear       | linear-workflows                         |
| yellow-review       | pr-review-workflow, CLAUDE.md            |
| yellow-ruvector     | ruvector-conventions, agent-learning     |

## Agent .md Files: Same Rule, Different Trigger

The YAML folded scalar restriction applies equally to agent `.md` files, not
only SKILL.md files. The failure mode is silent: Claude Code's frontmatter
parser silently drops the description rather than emitting a diagnostic.

**Broken agent frontmatter (PR #69, `test-reporter.md`):**

```yaml
---
name: test-reporter
description: >
  Analyzes test run output and produces a structured report. Use when a CI
  run has completed and you need a readable summary.
---
```

**Fixed:**

```yaml
---
name: test-reporter
description: "Analyzes test run output and produces a structured report. Use when a CI run has completed and you need a readable summary."
---
```

### Multi-Line Single-Quoted YAML Strings Also Fail (PR #70)

Multi-line YAML strings are not limited to `>` (folded scalar) — a single-quoted
string spanning multiple YAML lines also fails the parser:

**Broken (PR #70, multi-line single-quoted string):**

```yaml
---
name: pattern-recognition-specialist
description: 'Identifies recurring anti-patterns and structural problems in plugin
  code. Use when reviewing multiple agent files for systematic quality issues.'
---
```

Claude Code's line-by-line frontmatter parser reads `description:` as the
first line only: `'Identifies recurring anti-patterns...'` (truncated, possibly
unclosed). The continuation line is treated as an unknown attribute and
silently dropped.

**Fixed:**

```yaml
---
name: pattern-recognition-specialist
description: "Identifies recurring anti-patterns and structural problems in plugin code. Use when reviewing multiple agent files for systematic quality issues."
---
```

**Rule:** ALL of the following must be single-line: `description: >`, `description: |`,
and `description: 'multi\n  line'`. Use double-quoted strings on one line only.

### On-Touch Check Rule

Whenever ANY agent or skill `.md` file is touched in a PR (even for unrelated
changes), verify that its `description:` field is a single-line quoted string
with no `>` or `|` folded/literal scalar syntax, and that the value does not
wrap across lines.

```bash
# Grep for folded-scalar descriptions across all agent and skill files
grep -r '^description: [>|]' plugins/*/agents/*.md plugins/*/skills/*/*.md

# Grep for single-quoted descriptions that continue on the next line
grep -rA1 "^description: '" plugins/*/agents/*.md plugins/*/skills/*/*.md \
  | grep -B1 "^  "
```

## Prevention

1. **Use the correct attribute name:** Always `user-invokable` (with k)
2. **Keep frontmatter values single-line:** No `>`, `|`, or multi-line YAML
   constructs in any `.md` plugin file (skills AND agents)
3. **On-touch check:** Run the grep above whenever any agent or skill `.md` is
   modified — folded scalars may be pre-existing and surface only on next touch
4. **Check VS Code diagnostics** before committing changes to SKILL.md files
5. **Update `create-agent-skills` SKILL.md** when attribute names change — it's
   the documentation source other plugin authors reference
6. **Add to MEMORY.md:** The correct spelling and format rule are now in project
   memory

## Cross-References

- PR #23: Marketplace readiness audit (where fix was applied)
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md`: Canonical
  documentation for skill authoring
- `docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md`:
  Related plugin quality patterns
- Memory: `Plugin Authoring Quality Rules` section updated with new rules
