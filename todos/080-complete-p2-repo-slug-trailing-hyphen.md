---
status: complete
priority: p2
issue_id: '080'
tags: [code-review, yellow-ci, validation]
dependencies: []
---

# Repo Slug Trailing Hyphen Validation

## Problem Statement

The `validate_repo_slug()` function has an incorrect comment claiming "GitHub
allows trailing hyphen in org names" and the validation logic allows trailing
hyphens by falling through the `*-)` case. However, GitHub actually rejects
trailing hyphens in organization names, making this validation too permissive.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/lib/validate.sh`

**Line 205:**

```bash
case "$slug" in
    # GitHub allows trailing hyphen in org names, but not leading
    -*) return 1 ;;
    *-)  ;;  # falls through, allowing trailing hyphen
    *) ;;
esac
```

**GitHub Organization Name Rules:**

According to GitHub documentation:

- Must start and end with alphanumeric character
- May contain hyphens in the middle
- Cannot start or end with hyphen
- Example valid: `my-org`, `github`
- Example invalid: `my-org-`, `-my-org`, `-`

**Current Behavior:**

- Rejects leading hyphen: `"-myorg/repo"` → fails ✓
- **Allows trailing hyphen:** `"myorg-/repo"` → passes ✗
- Comment is incorrect

**Impact:**

- Accepts invalid repository slugs
- False positives in validation
- Could cause API errors when using validated slugs

## Proposed Solutions

Fix both the validation logic and the comment to correctly reject trailing
hyphens.

**Implementation:**

```bash
case "$slug" in
    # GitHub requires alphanumeric start/end (hyphens only in middle)
    -*) return 1 ;;  # reject leading hyphen
    *-) return 1 ;;  # reject trailing hyphen
    *) ;;
esac
```

**Alternative (More Explicit):**

```bash
# Check for leading or trailing hyphens (GitHub restriction)
case "$slug" in
    -*|*-)
        return 1
        ;;
    *)
        ;;
esac
```

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/validate.sh:205`

**Test Cases:**

```bash
# Valid slugs (should pass)
validate_repo_slug "owner/repo"
validate_repo_slug "my-org/my-repo"
validate_repo_slug "org123/repo456"

# Invalid: trailing hyphen in org (should fail)
validate_repo_slug "owner-/repo"

# Invalid: trailing hyphen in repo (should fail)
validate_repo_slug "owner/repo-"

# Invalid: leading hyphen in org (should fail)
validate_repo_slug "-owner/repo"

# Invalid: leading hyphen in repo (should fail)
validate_repo_slug "owner/-repo"

# Invalid: both (should fail)
validate_repo_slug "-owner-/-repo-"
```

**Additional Validation:**

The function should validate both the org name and repo name:

- Split on `/` delimiter
- Check each component for leading/trailing hyphens
- Ensure neither component is empty

**Current Implementation Gap:** The current case statement only checks the
entire slug, not the individual components. A slug like `"valid-org/repo-"`
would not be caught.

**Enhanced Solution:**

```bash
# Split and validate org/repo separately
local org="${slug%/*}"
local repo="${slug#*/}"

# Validate org name
case "$org" in
    -*|*-|"") return 1 ;;
esac

# Validate repo name
case "$repo" in
    -*|*-|"") return 1 ;;
esac
```

## Acceptance Criteria

- [ ] Comment corrected to reflect GitHub's actual rules
- [ ] Validation rejects trailing hyphens in org names
- [ ] Validation rejects trailing hyphens in repo names
- [ ] Validation rejects leading hyphens (already working)
- [ ] Tests added to validate.bats for all cases
- [ ] All existing tests pass
- [ ] No false positives (valid slugs still accepted)
- [ ] No false negatives (invalid slugs properly rejected)
