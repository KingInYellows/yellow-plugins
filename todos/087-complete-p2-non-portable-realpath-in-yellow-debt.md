---
status: pending
priority: p2
issue_id: '087'
tags: [code-review, quality, portability]
dependencies: []
---

# 🟡 P2: Non-portable realpath usage in yellow-debt

## Problem Statement

The `yellow-debt/lib/validate.sh` script uses GNU-specific `realpath -m` flag at
line 74, which is not available on macOS/BSD systems. This creates a portability
issue, while `yellow-ruvector` demonstrates a portable fallback pattern using
`cd`+`pwd`.

## Findings

File: `plugins/yellow-debt/lib/validate.sh:74`

Current code uses:

```bash
realpath -m "$path"
```

The `-m` flag (allow missing components) is GNU-specific and not available in
BSD/macOS realpath.

**yellow-ruvector's portable pattern:**

```bash
# Portable canonicalization using cd + pwd fallback
if command -v realpath >/dev/null 2>&1; then
  realpath "$path" 2>/dev/null || (cd "$(dirname "$path")" && pwd)
else
  (cd "$(dirname "$path")" && pwd)/$(basename "$path")
fi
```

## Proposed Solutions

### Solution 1: Add portable fallback like yellow-ruvector (Recommended)

Implement a portable canonicalization function that works on both GNU/Linux and
macOS/BSD.

**Pros:**

- Works across all platforms
- Consistent with yellow-ruvector approach
- Handles missing files gracefully
- No external dependencies

**Cons:**

- Slightly more complex than single command
- cd+pwd fallback is slower (but negligible for validation use case)

**Effort:** 30 minutes **Risk:** Low

### Solution 2: Require GNU coreutils on macOS

Document that macOS users must install GNU coreutils.

**Pros:**

- Simpler code

**Cons:**

- Adds dependency
- Worse user experience
- Inconsistent with yellow-ruvector
- Against portability best practices

**Effort:** 15 minutes **Risk:** Medium (user friction)

## Recommended Action

Adopt Solution 1: implement portable canonicalization fallback.

## Technical Details

File: `plugins/yellow-debt/lib/validate.sh:74`

Replace:

```bash
realpath -m "$path"
```

With portable function:

```bash
canonicalize_path() {
  local path="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$path" 2>/dev/null || {
      # Fallback for BSD/macOS or missing paths
      if [ -e "$path" ]; then
        (cd "$(dirname "$path")" && pwd)/$(basename "$path")
      else
        printf '%s\n' "$path"  # Return as-is for missing paths
      fi
    }
  else
    # No realpath available, use cd+pwd
    if [ -e "$path" ]; then
      (cd "$(dirname "$path")" && pwd)/$(basename "$path")
    else
      printf '%s\n' "$path"
    fi
  fi
}

canonical_path=$(canonicalize_path "$path")
```

## Acceptance Criteria

- [ ] Path canonicalization works on macOS without GNU coreutils
- [ ] Path canonicalization works on Linux
- [ ] Handles existing and non-existing paths correctly
- [ ] Pattern is consistent with yellow-ruvector approach
- [ ] No new external dependencies required

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh` (portable reference
  implementation)
- Project memory: "Shell Script Security Patterns"
