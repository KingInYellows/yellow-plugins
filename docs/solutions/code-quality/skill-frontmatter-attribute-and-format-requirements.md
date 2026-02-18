---
title: "Skill Frontmatter Attribute Name and Format Requirements"
category: code-quality
tags: [claude-code, skill, frontmatter, yaml, plugin-authoring]
module: plugins (all)
symptom: "VS Code diagnostics: 'Attribute user-invocable is not supported' and 'Unexpected indentation' on SKILL.md files"
root_cause: "Wrong attribute spelling (user-invocable vs user-invokable) and unsupported YAML folded scalar format in descriptions"
date: 2026-02-17
pr: "#23"
---

# Skill Frontmatter Attribute Name and Format Requirements

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

Claude Code's supported attribute is spelled `user-invokable` (with **k**), not `user-invocable` (with **c**). The typo propagated across all plugins because the first skill was written with `user-invocable` and all subsequent skills copied the pattern.

### 2. YAML folded scalars not supported

Claude Code's frontmatter parser does **not** support YAML folded scalar syntax (`>`). It uses a simple line-by-line parser, not a full YAML parser.

**Broken format:**
```yaml
---
name: my-skill
description: >
  Multi-line description that spans
  several lines using YAML folded scalar.
user-invokable: false
---
```

Each continuation line (`Multi-line description...`, `several lines...`) is parsed as a separate invalid attribute.

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
2. **Flatten description:** Convert `description: >` multi-line to a single-line `description: ...`
3. **Update body text:** Change prose references from "user-invocable" to "user-invokable" for consistency

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

| Plugin | Files Fixed |
|--------|------------|
| yellow-browser-test | agent-browser-patterns, test-conventions |
| yellow-chatprd | chatprd-conventions |
| yellow-ci | ci-conventions, diagnose-ci |
| yellow-core | create-agent-skills, git-worktree |
| yellow-debt | debt-conventions |
| yellow-devin | devin-workflows |
| yellow-linear | linear-workflows |
| yellow-review | pr-review-workflow, CLAUDE.md |
| yellow-ruvector | ruvector-conventions, agent-learning |

## Prevention

1. **Use the correct attribute name:** Always `user-invokable` (with k)
2. **Keep frontmatter values single-line:** No `>`, `|`, or multi-line YAML constructs
3. **Check VS Code diagnostics** before committing changes to SKILL.md files
4. **Update `create-agent-skills` SKILL.md** when attribute names change — it's the documentation source other plugin authors reference
5. **Add to MEMORY.md:** The correct spelling and format rule are now in project memory

## Cross-References

- PR #23: Marketplace readiness audit (where fix was applied)
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md`: Canonical documentation for skill authoring
- `docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md`: Related plugin quality patterns
- Memory: `Plugin Authoring Quality Rules` section updated with new rules
