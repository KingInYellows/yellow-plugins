---
status: complete
priority: p2
issue_id: "049"
tags: [code-review, security, path-validation]
dependencies: []
pr_number: 12
---

# 🟡 P2: Insufficient Path Validation in Audit Command

## Problem Statement

The audit command validates path filters using `validate_file_path()` but doesn't normalize paths first, allowing inconsistent formats like `./././src` and potential argument injection via paths like `--category=evil`.

## Findings

**Location**: `plugins/yellow-debt/commands/debt/audit.md:35, 66-69`

**Issue**: Path like `src/--category=evil` passes validation and could confuse `git ls-files` if interpreted as flag.

**Source**: Security Sentinel H2

## Proposed Solutions

### Solution 1: Normalize Before Validation

```bash
RAW_PATH_FILTER="${1:-.}"

if [ "$RAW_PATH_FILTER" != "." ]; then
  PATH_FILTER=$(realpath -m "$RAW_PATH_FILTER") || exit 1
  PROJECT_ROOT=$(git rev-parse --show-toplevel)
  PATH_FILTER=$(realpath -m --relative-to="$PROJECT_ROOT" "$PATH_FILTER")
else
  PATH_FILTER="."
fi

validate_file_path "$PATH_FILTER" || exit 1

# Verify exists
[ "$PATH_FILTER" != "." ] && [ ! -e "$PATH_FILTER" ] && exit 1
```

**Effort**: Small (1 hour)

## Recommended Action

Implement normalization.

## Acceptance Criteria

- [x] Path normalized before validation
- [x] Existence check added
- [x] Test with paths containing `--flags` fails safely

## Resources

- Security audit: `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:476-553`

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Completed
**By:** pr-comment-resolver
**Changes:**
- Implemented path normalization before validation using `realpath -m`
- Added existence check for non-"." paths
- Path now normalized to project-relative before validation
- Updated file: `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-debt/commands/debt/audit.md:35-88`
**Result:** Paths like `./././src` and `src/--category=evil` now properly normalized and validated, preventing argument injection to `git ls-files`
