---
status: complete
priority: p3
issue_id: "087"
tags: [code-review, yellow-ci, performance]
dependencies: []
---

# has_newline() Subprocess Optimization

## Problem Statement

`has_newline()` spawns a `tr` subprocess on every call. It's called from 8 validation functions, adding ~2.5ms per validation call unnecessarily.

## Findings

- **File**: `plugins/yellow-ci/hooks/scripts/lib/validate.sh:8-14`
- **Current**: `printf | tr -d '\n\r'` + length comparison (1 subprocess)
- **Call sites**: 8 validation functions
- **Cost**: ~2.5ms per call vs ~0.001ms with case pattern

**Current implementation:**
```bash
has_newline() {
  local raw="$1"
  local raw_len=${#raw}
  local oneline
  oneline=$(printf '%s' "$raw" | tr -d '\n\r')
  [ ${#oneline} -ne "$raw_len" ]
}
```

## Proposed Solutions

**Option 1 (Recommended): Bash case pattern matching**
```bash
has_newline() {
  case "$1" in
    *$'\n'*|*$'\r'*) return 0 ;;
    *) return 1 ;;
  esac
}
```
- **Pros**: 2500x faster, simpler, no subprocess
- **Cons**: Uses bash ANSI-C quoting ($'\n') — scripts are already bash
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Replace tr subprocess with case pattern
- [ ] All existing newline injection tests pass
- [ ] Verify $'\n' and $'\r' detection works in bash
