---
status: complete
priority: p1
issue_id: '021'
tags: [code-review, security, implementation-gap]
dependencies: []
---

# Route filter validation not implemented

## Problem Statement

The browser-test command describes route filter validation in prose ("validate
the filter") but provides no actual validation code. This is only an instruction
to the LLM, which may skip or misinterpret it. The validation must be concrete
code, not a suggestion.

## Findings

**File:** `plugins/yellow-browser-test/commands/browser-test/test.md` (lines
~25-30)

**Issue:** The command contains prose instruction for validation:

```markdown
3. Validate the route filter to ensure it's safe
4. Pass the filter to agent-browser for testing
```

This is NOT executable code — it's a suggestion to the LLM. The LLM might:

- Skip validation entirely
- Implement incomplete validation
- Misunderstand what "safe" means
- Forget validation on subsequent invocations

**Difference from issue #018:**

- **#018** (path traversal validation): Defines WHAT patterns to reject
- **#021** (this issue): The validation isn't enforced in CODE

Both must be fixed, but they're distinct problems.

## Proposed Solutions

### Option A: Explicit validation bash snippet in command (Recommended)

Replace prose instruction with concrete code block:

````markdown
## Validation

Execute this validation before testing:

```bash
# Validate route filter format
if [ -z "$ARGUMENTS" ]; then
  printf 'Error: Route filter required.\n' >&2
  exit 1
fi

# Reject path traversal sequences
if echo "$ARGUMENTS" | grep -qE '\.\.|%|//'; then
  printf 'Error: Route filter contains invalid sequences (.. % //).\n' >&2
  printf 'Use format: /path/to/route\n' >&2
  exit 1
fi

# Require valid path format
if ! echo "$ARGUMENTS" | grep -qE '^/[a-zA-Z0-9/_-]*$'; then
  printf 'Error: Invalid route filter format.\n' >&2
  printf 'Use format: /path/to/route (alphanumeric, /, -, _ only).\n' >&2
  exit 1
fi

printf 'Route filter validated: %s\n' "$ARGUMENTS"
```
````

````

**Pros:**
- Validation is guaranteed to run
- Clear error messages
- No LLM interpretation required
- Matches yellow-ruvector validation precedent

**Cons:**
- Code block in command file (but precedent exists)

### Option B: Move to shared validation skill

Create `skills/route-filter-validation/` with validation logic, source it:

```bash
# Source validation library
. "$PLUGIN_DIR/skills/route-filter-validation/validate.sh"

# Validate route filter
validate_route_filter "$ARGUMENTS" || exit 1
````

**Pros:**

- Reusable across commands
- Centralized validation logic
- Matches yellow-ruvector lib/validate.sh pattern

**Cons:**

- More complex for simple validation
- Need to create new skill structure

## Recommended Action

Implement **Option A** for immediate fix, with the following steps:

1. Replace prose validation instruction with concrete bash code block
2. Add validation to test.md command
3. Add identical validation to explore.md command
4. Ensure validation runs BEFORE any agent-browser invocation
5. Test with invalid filters to verify error messages
6. Consider Option B (shared skill) if validation grows more complex

## Technical Details

**Current code location:**

- `plugins/yellow-browser-test/commands/browser-test/test.md` (lines ~25-30)
- `plugins/yellow-browser-test/commands/browser-test/explore.md` (similar
  pattern)

**Validation requirements:**

- Non-empty filter
- No path traversal: `..`, `%`, `//`
- Valid path format: `^/[a-zA-Z0-9/_-]*$`
- Clear error messages for each failure case

**Command file precedent:** From
`plugins/yellow-core/commands/git-worktree/create.md`:

```bash
# Commands can contain bash code blocks
validate_name "$BRANCH_NAME" || exit 1
```

**Shared validation precedent:** From
`plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`:

```bash
validate_namespace() {
  # Concrete validation implementation
}
```

## Acceptance Criteria

- [ ] Route filter validation is concrete bash code (not prose instruction)
- [ ] Validation added to test.md command
- [ ] Validation added to explore.md command
- [ ] Empty filter produces error: "Route filter required"
- [ ] Invalid sequences produce error: "contains invalid sequences"
- [ ] Invalid format produces error: "Invalid route filter format"
- [ ] Error messages include usage example: "/path/to/route"
- [ ] Validation runs BEFORE agent-browser invocation
- [ ] Tested with various invalid inputs

## Work Log

| Date       | Action                          | Learnings                                                                               |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | Security validation must be concrete executable code, not prose instructions to the LLM |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- File: `plugins/yellow-browser-test/commands/browser-test/test.md`
- Precedent: `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh` (shared
  validation)
- Precedent: `plugins/yellow-core/commands/git-worktree/create.md` (bash in
  commands)
- Related: Issue #018 (defines what patterns to reject)
