---
status: pending
priority: p2
issue_id: '080'
tags: [code-review, security, validation]
dependencies: []
---

# 🟡 P2: Incomplete path traversal validation in yellow-debt

## Problem Statement

The path traversal pattern in `yellow-debt/lib/validate.sh` line 67 uses
`*../*|*/..|../*|..` which is less strict than the pattern used in
`yellow-ruvector`. This creates inconsistent defense-in-depth across plugins and
could miss edge cases.

## Findings

**yellow-debt pattern (incomplete):**

```bash
# Line 67
case "$name" in
  *../*|*/..|../*|..) return 1 ;;
```

**yellow-ruvector pattern (stricter):**

```bash
case "$name" in
  *..*|/*|~*) return 1 ;;
```

The yellow-ruvector pattern catches ANY occurrence of `..` regardless of
surrounding characters, making it more robust. The yellow-debt pattern only
catches specific combinations and could miss variants like:

- `..` at the start without trailing slash
- `..` embedded differently (e.g., `foo..bar`)

## Proposed Solutions

### Solution 1: Adopt yellow-ruvector's stricter pattern (Recommended)

Change yellow-debt's pattern to `*..*|/*|~*` to match yellow-ruvector's
approach.

**Pros:**

- More comprehensive protection
- Consistent across plugins
- Simpler pattern to maintain
- Catches more edge cases

**Cons:**

- May be slightly more restrictive (could reject legitimate names with ..)

**Effort:** 15 minutes **Risk:** Low

### Solution 2: Document rationale for different patterns

Keep different patterns but document why yellow-debt uses a more permissive
check.

**Pros:**

- Preserves existing behavior

**Cons:**

- Inconsistent security posture
- No clear rationale for different patterns
- Harder to audit

**Effort:** 30 minutes **Risk:** Medium (leaves potential vulnerability)

## Recommended Action

Adopt Solution 1: change to `*..*|/*|~*` pattern for consistency and stronger
protection.

## Technical Details

File: `plugins/yellow-debt/lib/validate.sh:67`

Change from:

```bash
case "$name" in
  *../*|*/..|../*|..) return 1 ;;
```

To:

```bash
case "$name" in
  *..*|/*|~*) return 1 ;;
```

This aligns with the project memory pattern: "Reject path traversal: `..`, `/`,
`~` in names"

## Acceptance Criteria

- [ ] yellow-debt uses `*..*|/*|~*` pattern
- [ ] Pattern matches yellow-ruvector's validation
- [ ] Existing tests still pass
- [ ] No legitimate use cases are broken

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Project memory: "Shell Script Security Patterns"
- `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh` (reference
  implementation)
