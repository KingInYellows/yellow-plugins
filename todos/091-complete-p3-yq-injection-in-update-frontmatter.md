---
status: pending
priority: p3
issue_id: "091"
tags: [code-review, security, validation]
dependencies: []
---

# 🔵 P3: YQ Injection in Update Frontmatter

## Problem Statement
The update_frontmatter function in yellow-debt's validation library interpolates a `$field` parameter directly into a yq expression without validation, creating potential command injection risk if called with untrusted input.

## Findings
**Location**: `plugins/yellow-debt/lib/validate.sh` line 33

Current code (simplified):
```bash
update_frontmatter() {
    local file="$1"
    local field="$2"
    local value="$3"

    yq eval "$field = \"$value\"" -i "$file"
}
```

The `$field` parameter is used directly in the yq expression. While current callers may only pass trusted field names, defense-in-depth requires validation.

From project memory: "validate it matches ^\.[a-z]+$ before use"

## Proposed Solutions
### Solution 1: Add Field Name Validation (Recommended)
Validate that `$field` matches the expected pattern before use:

```bash
update_frontmatter() {
    local file="$1"
    local field="$2"
    local value="$3"

    # Validate field name format
    case "$field" in
        .[a-z]*) ;;
        *)
            printf 'Error: Invalid field name: %s\n' "$field" >&2
            return 1
            ;;
    esac

    yq eval "$field = \"$value\"" -i "$file"
}
```

### Solution 2: Whitelist Allowed Fields
If only specific fields are ever updated, use explicit whitelist:

```bash
case "$field" in
    .status|.priority|.tags) ;;
    *)
        printf 'Error: Field not allowed: %s\n' "$field" >&2
        return 1
        ;;
esac
```

## Recommended Action
Apply Solution 1 for flexibility with safety. Add validation before the yq call to ensure `$field` matches the pattern `.[a-z]+`.

This addresses the injection risk noted in project memory while maintaining function generality.

## Acceptance Criteria
- [ ] Field parameter validated against `.[a-z]*` pattern before use
- [ ] Invalid field names rejected with error message
- [ ] All existing callers continue to work (validated field names)
- [ ] Unit tests added for validation logic if test suite exists

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- File: `plugins/yellow-debt/lib/validate.sh`
- Project memory: Bash Hook & Validation Patterns (yq injection prevention)
