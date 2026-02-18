---
status: pending
priority: p2
issue_id: '083'
tags: [code-review, quality, shell-patterns]
dependencies: []
---

# 🟡 P2: Unquoted variables in awk example in pr-review-workflow skill

## Problem Statement

The `yellow-review/skills/pr-review-workflow/SKILL.md` file contains a shell
code example at line 78 with unquoted variables in an awk command, violating the
project convention that "Quote ALL variables in code examples."

## Findings

File: `plugins/yellow-review/skills/pr-review-workflow/SKILL.md:78`

The awk example shows variables without proper quoting, which:

- Violates documented shell patterns
- Could mislead users copying the code
- Inconsistent with security-focused quoting requirements

## Proposed Solutions

### Solution 1: Fix variable quoting in awk example (Recommended)

Update the awk example to properly quote all shell variables.

**Pros:**

- Aligns with project conventions
- Shows correct, safe pattern
- Prevents cargo-cult bugs

**Cons:**

- None

**Effort:** 10 minutes **Risk:** Low

## Recommended Action

Fix the variable quoting in the awk example at line 78.

## Technical Details

File: `plugins/yellow-review/skills/pr-review-workflow/SKILL.md:78`

Ensure all shell variables in the awk example use proper quoting:

```bash
# If passing shell variables to awk
awk -v var="$shell_var" '...'

# Or for array access
for item in "$array[@]"; do
  awk -v val="$item" '...'
done
```

Never:

```bash
# Bad (unquoted)
awk -v var=$shell_var '...'
```

## Acceptance Criteria

- [ ] All variables in awk example at line 78 are properly quoted
- [ ] Pattern follows project shell conventions
- [ ] Example demonstrates safe shell/awk integration

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Project memory: "Shell Documentation Patterns - Quote ALL variables in code
  examples"
