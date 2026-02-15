---
status: pending
priority: p1
issue_id: "077"
tags: [code-review, quality, skill-structure]
dependencies: []
---

# 🔴 P1: Debt Conventions Skill Missing Standard SKILL.md Structure

## Problem Statement
The yellow-debt/skills/debt-conventions/SKILL.md file is the only skill in the entire marketplace that doesn't follow the standard SKILL.md structure. It's missing YAML frontmatter with `name`, `description` (with "Use when..." trigger clause), and `user-invocable` field. It also lacks the standard `## Usage` heading and error handling catalog. This inconsistency violates the plugin authoring quality rules and makes the skill harder to discover and invoke correctly.

## Findings
**Current state:**
- Location: `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
- Missing: YAML frontmatter entirely
- Missing: `## Usage` heading
- Missing: Error handling catalog
- Has: Content sections (todo format, status values, commit conventions, etc.)

**Structure gap:**
All other skills follow this pattern:
```markdown
---
name: skill-name
description: Brief description. Use when <trigger clause>.
user-invocable: true/false
---

# Skill Name

## What It Does
...

## When to Use
Use this skill when...

## Usage
### Command: /command-name
...

## Error Handling
...
```

**debt-conventions current structure:**
```markdown
# Technical Debt Conventions

## Todo File Format
...

## Status Values
...

## Commit Message Format
...
```

**Impact:**
- Violates plugin authoring quality rules (PR #8)
- No clear "Use when..." trigger for agents to know when to invoke
- Missing `user-invocable` declaration
- No error handling guidance
- Inconsistent with all other skills in marketplace

## Proposed Solutions

### Solution 1: Add Standard SKILL.md Structure (Recommended)
Add YAML frontmatter, restructure with standard headings, add error handling catalog.

**Add frontmatter:**
```yaml
---
name: debt-conventions
description: Technical debt tracking conventions for yellow-debt plugin. Use when creating, updating, or validating technical debt todo files, status values, or commit messages.
user-invocable: false
---
```

**Restructure headings:**
1. Keep existing content
2. Add `## What It Does` section (brief summary)
3. Add `## When to Use` section with trigger clause
4. Rename main content to `## Usage` (keep all subsections)
5. Add `## Error Handling` section cataloging validation errors

**Error handling catalog to add:**
Document common validation errors from hooks/scripts:
- Invalid status values (must be: pending, ready, in-progress, blocked, resolved, deferred, cancelled)
- Invalid priority values (must be: p0, p1, p2, p3)
- Missing required frontmatter fields (status, priority, issue_id, tags)
- Invalid tag format (must be lowercase, hyphen-separated)
- Invalid commit message format (must follow conventional commits)
- Path traversal in issue_id or file paths
- CRLF line endings in shell scripts

**Pros:**
- Consistent with all other skills
- Clear trigger clause for agents
- Complete error handling reference
- Follows plugin authoring quality rules
- Minimal disruption (additive changes)

**Cons:**
- Slightly more verbose
- Need to write error catalog

**Effort:** Low (1-2 hours)
**Risk:** Very low (additive, non-breaking)

### Solution 2: Minimal Frontmatter Only
Add just YAML frontmatter, skip heading restructure.

**Pros:**
- Faster to implement
- Meets technical requirement

**Cons:**
- Still inconsistent with other skills
- Missing error handling catalog
- No clear trigger clause in body

**Effort:** Very low (30 min)
**Risk:** Very low

## Recommended Action
**Implement Solution 1**: Add full standard SKILL.md structure including frontmatter, headings, and error catalog.

**Execution plan:**
1. Add YAML frontmatter at top of file:
   ```yaml
   ---
   name: debt-conventions
   description: Technical debt tracking conventions for yellow-debt plugin. Use when creating, updating, or validating technical debt todo files, status values, or commit messages.
   user-invocable: false
   ---
   ```
2. After title, add `## What It Does` section (~3-4 sentences summarizing the skill)
3. Add `## When to Use` section:
   - "Use this skill when you need to:"
   - Create or update technical debt todo files
   - Validate todo file format and metadata
   - Format commit messages for debt work
   - Understand yellow-debt status lifecycle
4. Rename main content heading to `## Usage` (keep all existing subsections as-is):
   - `### Todo File Format`
   - `### Status Values`
   - `### Commit Message Format`
   - etc.
5. Add `## Error Handling` section at end with catalog:
   - Invalid status/priority values
   - Missing required frontmatter
   - Invalid tag format
   - Path traversal attempts
   - Line ending issues
   - Reference hook scripts for validation logic
6. Verify content unchanged, only structure added
7. Run `pnpm validate:plugins` to ensure schema compliance
8. Check that debt-related agents can still reference the skill

## Technical Details
**Current file location:**
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md`

**Standard SKILL.md pattern (from other skills):**
- Example: `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
- Example: `plugins/yellow-core/skills/git-worktree/SKILL.md`

**Frontmatter fields:**
- `name` (required): Skill identifier (kebab-case)
- `description` (required): Must include "Use when..." trigger clause
- `user-invocable` (required): `false` for conventions/reference skills

**Error handling sources:**
Reference these for error catalog:
- `plugins/yellow-debt/hooks/scripts/validate-debt-todo.sh`
- `plugins/yellow-debt/hooks/scripts/lib/validate.sh`
- `plugins/yellow-debt/tests/*.bats` (test fixtures show error cases)

**Section order:**
1. YAML frontmatter
2. Main title (`# Technical Debt Conventions`)
3. `## What It Does`
4. `## When to Use`
5. `## Usage` (with all existing subsections)
6. `## Error Handling`

## Acceptance Criteria
- [ ] YAML frontmatter added with `name`, `description` (with "Use when..."), `user-invocable: false`
- [ ] `## What It Does` section added (3-4 sentences)
- [ ] `## When to Use` section added with trigger clause and bullet list
- [ ] Main content under `## Usage` heading (all existing subsections preserved)
- [ ] `## Error Handling` section added with validation error catalog
- [ ] Error catalog includes: status/priority values, frontmatter, tags, path traversal, line endings
- [ ] All existing content preserved (only structure added)
- [ ] `pnpm validate:plugins` passes
- [ ] debt-related agents can still reference skill
- [ ] File consistent with other skills in marketplace

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review. debt-conventions is the only skill missing YAML frontmatter and standard SKILL.md structure (## Usage heading, error handling catalog).

## Resources
- Plugin marketplace review session
- Skill file: `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
- Standard structure examples:
  - `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
  - `plugins/yellow-core/skills/git-worktree/SKILL.md`
- Validation logic: `plugins/yellow-debt/hooks/scripts/validate-debt-todo.sh`
- Quality rule source: PR #8 review, `docs/plugin-validation-guide.md`
