---
name: debt:fix
description: "Agent-driven remediation of specific debt findings with human approval. Use when you want to fix a specific technical debt item."
argument-hint: "<todo-path>"
allowed-tools:
  - Bash
  - Read
  - Task
  - AskUserQuestion
---

# Technical Debt Fix Command

Agent-driven remediation of a specific technical debt finding with mandatory human approval before committing changes.

## Arguments

- `<path>` — Path to todo file (e.g., `todos/debt/042-ready-high-complexity.md`)

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source shared validation library for extract_frontmatter and transition_todo_state
# shellcheck source=../../lib/validate.sh
. "$(dirname "${BASH_SOURCE[0]}")/../../lib/validate.sh"

# Parse arguments
if [ $# -ne 1 ]; then
  printf 'Usage: /debt:fix <todo-id>\n' >&2
  exit 1
fi

TODO_PATH="${1:-}"

if [ -z "$TODO_PATH" ]; then
  printf 'ERROR: Missing required argument <path>\n' >&2
  printf 'Usage: /debt:fix <path-to-todo>\n' >&2
  printf 'Example: /debt:fix todos/debt/042-ready-high-complexity.md\n' >&2
  exit 1
fi

# Validate path (must be under todos/debt/, reject traversal)
validate_file_path "$TODO_PATH" || {
  printf 'ERROR: Invalid path "%s" (path traversal detected)\n' "$TODO_PATH" >&2
  exit 1
}

# Verify path is under todos/debt/
case "$TODO_PATH" in
  todos/debt/*) ;;
  *)
    printf 'ERROR: Path must be under todos/debt/\n' >&2
    exit 1
    ;;
esac

# Verify file exists
if [ ! -f "$TODO_PATH" ]; then
  printf 'ERROR: Todo file not found: %s\n' "$TODO_PATH" >&2
  exit 1
fi

# Read todo metadata
STATUS=$(extract_frontmatter "$TODO_PATH" | yq -r '.status' 2>/dev/null)

# Verify status is ready
if [ "$STATUS" != "ready" ]; then
  printf 'ERROR: Todo status is "%s" (must be "ready")\n' "$STATUS" >&2
  printf 'Run /debt:triage to accept findings first.\n' >&2
  exit 1
fi

# Transition to in-progress using atomic function
printf '[fix] Transitioning todo to in-progress...\n' >&2

transition_todo_state "$TODO_PATH" "in-progress" || {
  printf '[fix] ERROR: Failed to transition state\n' >&2
  exit 1
}

# Update TODO_PATH after state transition (filename changed)
NEW_TODO_PATH=$(printf '%s' "$TODO_PATH" | sed 's/-ready-/-in-progress-/')

# Extract finding details
TITLE=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.title // "Untitled"' 2>/dev/null)
CATEGORY=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.category' 2>/dev/null)
SEVERITY=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.severity' 2>/dev/null)
TODO_ID=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.id' 2>/dev/null)

printf '[fix] Launching debt-fixer agent for: %s\n' "$TITLE" >&2
printf '[fix] Category: %s | Severity: %s | ID: %s\n' "$CATEGORY" "$SEVERITY" "$TODO_ID" >&2

# Launch debt-fixer agent with finding context
# The agent will:
# 1. Read the todo file to understand the finding
# 2. Implement the fix
# 3. Show git diff
# 4. Use AskUserQuestion for approval
# 5. On approval: commit via heredoc pattern
# 6. On rejection: git restore and revert state

printf '\nLaunching debt-fixer agent...\n'
printf 'Task(subagent_type="debt-fixer"): "Fix technical debt finding in %s. ' "$NEW_TODO_PATH"
printf 'Read todo file, implement fix, show diff, get approval, commit if approved."\n'

printf '\nThe debt-fixer agent will:\n'
printf '  1. Analyze the finding and implement a fix\n'
printf '  2. Show you the diff of changes\n'
printf '  3. Ask for your approval (MANDATORY - no auto-commit)\n'
printf '  4. On YES: commit changes and transition todo to complete\n'
printf '  5. On NO: revert changes and transition todo back to ready\n'

printf '\nSecurity note: All fixes require explicit human approval before committing.\n'

# Show next ready finding if any
NEXT_READY=$(find todos/debt -name '*-ready-*.md' 2>/dev/null | head -1)
if [ -n "$NEXT_READY" ]; then
  printf '\nNext ready finding: %s\n' "$NEXT_READY"
fi
```

## Example Usage

```bash
# Fix a specific finding
$ARGUMENTS todos/debt/042-ready-high-complexity.md

# Fix will fail if todo is not in 'ready' state
$ARGUMENTS todos/debt/001-pending-medium-duplication.md  # ERROR: must be ready
```

## Human-in-the-Loop Security

**CRITICAL**: The debt-fixer agent processes code analysis findings that may have been influenced by malicious code patterns (indirect prompt injection). Therefore:

1. Agent implements fix and shows `git diff --stat`
2. **MANDATORY**: Use `AskUserQuestion` with prompt:
   ```
   Review the diff above. Apply this fix and commit?

   Options:
   - Yes: Apply fix and commit changes
   - No: Discard changes and keep todo in 'ready' state
   ```
3. On "Yes": commit via `gt modify -c "fix: resolve <finding-title>"`
4. On "No": revert changes via `git restore`, reset todo to `ready`

**Never auto-commit without human review.**

## Commit Message Sanitization

Finding titles may contain shell metacharacters. Use printf for shell-safe quoting to prevent command injection:

```bash
# Extract and sanitize title
safe_title=$(printf '%s' "$finding_title" | LC_ALL=C tr -cd '[:alnum:][:space:]-_.' | cut -c1-72)

# Use printf (prevents injection)
gt modify -c "$(printf 'fix: resolve %s\n\nResolves todo: %s\nCategory: %s\nSeverity: %s' \
  "$safe_title" "$todo_path" "$category" "$severity")"
```

## State Transitions

**Success path**: `ready` → `in-progress` → `complete`
**Failure/rejection path**: `ready` → `in-progress` → `ready` (retry)

All transitions use atomic `transition_todo_state()` function.

## Error Recovery

If fix agent fails:
- Todo remains in `in-progress` state
- Run `/debt:fix` again to retry (will fail - need to manually reset to ready)
- Or manually transition back to ready: `transition_todo_state "<path>" ready`

If git changes need to be reverted:
```bash
git restore .
```
