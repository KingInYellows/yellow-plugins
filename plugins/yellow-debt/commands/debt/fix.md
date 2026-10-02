---
name: debt:fix
description: "Agent-driven remediation of specific debt findings with human approval. Use when you want to fix a specific technical debt item."
argument-hint: '<todo-id | todo-path>'
allowed-tools:
  - Bash
  - Read
  - Agent
  - AskUserQuestion
---

# Technical Debt Fix Command

Agent-driven remediation of a specific technical debt finding with mandatory
human approval before committing changes.

## Arguments

- `<todo-id | todo-path>` — The todo's numeric id (e.g. `042`) or its path
  (e.g. `todos/debt/042-ready-high-complexity.md`). The block resolves the
  file from the id and requires a given path to name that same file.

## Implementation

Replace `<todo-arg>` on the `bash /dev/fd/3` line with the command argument,
single-quoted. Stop with an error instead of running the block if the value
contains a single quote.

```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-arg>' 3<<'__YELLOW_DEBT_BASH__'
set -euo pipefail

# Source shared validation library for extract_frontmatter and transition_todo_state
# shellcheck source=../../lib/validate.sh
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"

# Parse arguments
if [ $# -ne 1 ] || [ -z "${1:-}" ]; then
  printf 'Usage: /debt:fix <todo-id | todos/debt/<id>-ready-...md>\n' >&2
  printf 'Example: /debt:fix 042\n' >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

# Resolve the todo from its numeric id; a path argument only supplies the id
# and must name the same file. The filename itself is repository-controlled
# and is never trusted as shell text.
TODO_ARG="$1"
case "$TODO_ARG" in
  todos/debt/*)
    TODO_ID="${TODO_ARG#todos/debt/}"
    TODO_ID="${TODO_ID%%-*}"
    ;;
  *) TODO_ID="$TODO_ARG" ;;
esac
TODO_PATH=$(debt_resolve_todo "$TODO_ID" ready) || {
  printf 'Run /debt:triage to accept findings first.\n' >&2
  exit 1
}
if [ "$TODO_ARG" != "$TODO_ID" ] && [ "$TODO_ARG" != "$TODO_PATH" ]; then
  printf 'ERROR: %s is not the ready todo for id %s\n' "$TODO_ARG" "$TODO_ID" >&2
  exit 1
fi

# Remediation runs in an isolated worktree and must start from a clean repo.
# Exclude .debt/ and todos/debt/ artifacts left by /debt:audit so the audit→fix flow works.
if [ -n "$(git status --porcelain --untracked-files=all | grep -Ev '^(\?\?|[MADRCU ]{2}) "?(\.debt/|todos/debt/)')" ]; then
  printf 'ERROR: /debt:fix requires a clean working tree (ignoring .debt/ and todos/debt/). Commit, stash, or discard unrelated changes first.\n' >&2
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
NEW_TODO_PATH=$(debt_resolve_todo "$TODO_ID" in-progress)

# Extract finding details
TITLE=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.title // "Untitled"' 2>/dev/null)
CATEGORY=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.category' 2>/dev/null)
SEVERITY=$(extract_frontmatter "$NEW_TODO_PATH" | yq -r '.severity' 2>/dev/null)

printf '[fix] Launching yellow-debt:remediation:debt-fixer agent for: %s\n' "$TITLE" >&2
printf '[fix] Category: %s | Severity: %s | ID: %s\n' "$CATEGORY" "$SEVERITY" "$TODO_ID" >&2

printf '[fix] Todo id: %s\n' "$TODO_ID" >&2
printf '[fix] In-progress todo path: %s\n' "$NEW_TODO_PATH" >&2
printf '[fix] Next step: launch yellow-debt:remediation:debt-fixer in an isolated worktree for this todo.\n' >&2

# Show next ready finding if any (only names that fit the todo pattern)
NEXT_READY=""
while IFS= read -r -d '' f; do
  if debt_todo_name_ok "${f##*/}"; then
    NEXT_READY="$f"
    break
  fi
done < <(find todos/debt -maxdepth 1 -type f -name '*-ready-*.md' -print0 2>/dev/null | sort -z)
if [ -n "$NEXT_READY" ]; then
  printf '\nNext ready finding: %s\n' "$NEXT_READY"
fi
__YELLOW_DEBT_BASH__
```

## Agent Orchestration

After the bash block succeeds, launch the fixer agent directly via the Agent tool with
the todo id and in-progress path the block printed, using this literal value:

```text
Agent(
  subagent_type="yellow-debt:remediation:debt-fixer",
  description="Fix debt finding",
  prompt="Remediate the technical debt finding with todo id <todo id printed
by the bash block above> (file: <in-progress todo path printed by the bash
block above>). Work in an isolated worktree for this todo."
)
```

The agent must run in its isolated worktree, read the todo
file, implement the fix, show the diff, request approval, and either commit or
restore only the files it changed before resetting the todo to `ready`.

## Example Usage

```bash
# Fix a specific finding by id or by path
$ARGUMENTS 042
$ARGUMENTS todos/debt/042-ready-high-complexity.md

# Fix will fail if todo is not in 'ready' state
$ARGUMENTS todos/debt/001-pending-medium-duplication.md  # ERROR: must be ready
```

## Human-in-the-Loop Security

**CRITICAL**: The debt-fixer agent processes code analysis findings that may
have been influenced by malicious code patterns (indirect prompt injection).
Therefore:

1. Agent implements fix and shows `git diff --stat`
2. **MANDATORY**: Use `AskUserQuestion` with prompt:

   ```
   Review the diff above. Apply this fix and commit?

   Options:
   - Yes: Apply fix and commit changes
   - No: Discard changes and keep todo in 'ready' state
   ```

3. On "Yes": commit via the active stacked-PR provider (see the debt-fixer
   agent's step 6 for the per-provider commands)
4. On "No": restore only touched files, reset todo to `ready`

**Never auto-commit without human review.**

## Commit Message Sanitization

Finding titles may contain shell metacharacters. Use printf for shell-safe
quoting to prevent command injection. (This section is illustrative — the
executed version lives in the debt-fixer agent's step 6. The lowercase
`$finding_title`/`$todo_path`/`$category`/`$severity` correspond to this
file's `TITLE`/`NEW_TODO_PATH`/`CATEGORY`/`SEVERITY`.)

```bash
# Extract and sanitize title
safe_title=$(printf '%s' "$finding_title" | LC_ALL=C tr -cd '[:alnum:][:space:]-_.' | cut -c1-72)

# Use printf (prevents injection); the actual commit command depends on
# which stacked-PR provider is active — see debt-fixer.md step 6
COMMIT_MSG=$(printf 'fix: resolve %s\n\nResolves todo: %s\nCategory: %s\nSeverity: %s' \
  "$safe_title" "$todo_path" "$category" "$severity")
```

## State Transitions

**Success path**: `ready` → `in-progress` → `complete` **Failure/rejection
path**: `ready` → `in-progress` → `ready` (retry)

All transitions use atomic `transition_todo_state()` function.

**Closing a todo while its fix runs**: the fixer works in an isolated git
worktree, which holds its own copy of the todo (none at all when `todos/` is
gitignored). A `wont-fix` made in the main checkout is not visible there, so a
running fixer does not stop at its next transition. Let the fix finish or
abandon it before closing the todo. A `wont-fix` todo is not a `/debt:fix`
target afterwards: it needs status `ready`.

## Error Recovery

If fix agent fails:

- Todo remains in `in-progress` state
- Run `/debt:fix` again to retry (will fail - need to manually reset to ready)
- Or manually transition back to ready, from the git root in a bash child
  that sources `lib/validate.sh`:
  `transition_todo_state "$(debt_resolve_todo '<id>' in-progress)" ready`

If git changes need to be reverted, restore only the files touched by the fix:

```bash
while IFS= read -r changed_file; do
  [ -z "$changed_file" ] && continue
  git restore --staged --worktree -- "$changed_file" 2>/dev/null || rm -f -- "$changed_file"
done < <(git status --porcelain | cut -c4-)
```
