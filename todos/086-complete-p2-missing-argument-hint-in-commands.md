---
status: pending
priority: p2
issue_id: '086'
tags: [code-review, consistency, frontmatter]
dependencies: []
---

# 🟡 P2: Missing argument-hint in 17 commands

## Problem Statement

17 of 48 commands across multiple plugins are missing the `argument-hint` field
in their frontmatter. This creates inconsistency in the command interface and
reduces discoverability of expected argument formats.

## Findings

Commands missing `argument-hint` are primarily in:

- yellow-review (multiple commands)
- yellow-chatprd (multiple commands)
- Scattered across other plugins

The `argument-hint` field should be present in all commands:

- Set to a descriptive string for commands that accept arguments (e.g.,
  `"<issue-number>"`, `"<pr-url>"`)
- Set to empty string `""` for commands that take no arguments

## Proposed Solutions

### Solution 1: Add argument-hint to all 17 commands (Recommended)

Audit each command's argument usage and add appropriate `argument-hint` value.

**Pros:**

- Improves command discoverability
- Consistent interface across all commands
- Better user experience
- Aligns with plugin quality conventions

**Cons:**

- Requires auditing 17 commands
- Must determine appropriate hint text for each

**Effort:** 2-3 hours **Risk:** Low

### Solution 2: Make argument-hint optional in validation

Update plugin schema to make the field optional.

**Pros:**

- No code changes needed

**Cons:**

- Reduces consistency
- Worse user experience
- Goes against quality conventions

**Effort:** 30 minutes **Risk:** Low

## Recommended Action

Adopt Solution 1: add `argument-hint` to all 17 commands with appropriate
values.

## Technical Details

For each command missing `argument-hint`:

1. Identify if it accepts arguments by checking for `$ARGUMENTS` placeholder
2. If yes: add descriptive hint like `"<pr-number>"`, `"<task-description>"`
3. If no: add empty string `""`

Example frontmatter:

```yaml
---
name: review-pr
description: Review a pull request
argument-hint: '<pr-number>'
allowed-tools: [Bash, Read, Write]
---
```

Or for no arguments:

```yaml
---
name: sync-repo
description: Sync repository with remote
argument-hint: ''
allowed-tools: [Bash]
---
```

## Acceptance Criteria

- [ ] All commands have `argument-hint` field in frontmatter
- [ ] Commands with arguments have descriptive hints
- [ ] Commands without arguments have empty string `""`
- [ ] `pnpm validate:plugins` passes
- [ ] Hints are consistent in format (e.g., all use angle brackets)

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Existing commands with proper `argument-hint` for reference
