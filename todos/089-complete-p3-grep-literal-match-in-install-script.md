---
status: pending
priority: p3
issue_id: '089'
tags: [code-review, shell-patterns]
dependencies: []
---

# 🔵 P3: Grep Literal Match in Install Script

## Problem Statement

The yellow-ruvector installation script uses regex grep when matching a literal
path string, creating potential edge case issues if the path contains regex
metacharacters.

## Findings

**Location**: `plugins/yellow-ruvector/scripts/install.sh` line 108

Current code:

```bash
grep -q "$HOME/.local/bin" "$HOME/.bashrc"
```

The `-q` flag provides quiet mode, but the pattern is treated as a regex. If
`$HOME` contains characters like `.` (which it does), they're interpreted as
regex metacharacters rather than literals.

## Proposed Solutions

### Solution 1: Use Fixed-String Grep (Recommended)

Change to `grep -qF` for literal/fixed-string matching:

```bash
grep -qF "$HOME/.local/bin" "$HOME/.bashrc"
```

This is defense-in-depth: while `$HOME` typically won't contain problematic
regex chars beyond `.`, using `-F` makes the intent explicit and prevents future
edge cases.

### Solution 2: Escape the Pattern

Manually escape regex metacharacters, but this is more fragile:

```bash
escaped=$(printf '%s' "$HOME/.local/bin" | sed 's/[.[\*^$]/\\&/g')
grep -q "$escaped" "$HOME/.bashrc"
```

## Recommended Action

Apply Solution 1: change `grep -q` to `grep -qF` on line 108.

This aligns with defense-in-depth shell patterns from project memory.

## Acceptance Criteria

- [ ] Line 108 uses `grep -qF` instead of `grep -q`
- [ ] Installation script tested on systems with typical `$HOME` paths
- [ ] No regex interpretation of literal path strings

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- File: `plugins/yellow-ruvector/scripts/install.sh`
- Project memory: Shell Script Security Patterns
