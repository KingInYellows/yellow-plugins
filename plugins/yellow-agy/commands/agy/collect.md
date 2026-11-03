---
name: agy:collect
# prettier-ignore
description: "Write a yellow-agy task's work out as patch files (commits and uncommitted changes) and scan them for secret-shaped content, ready for the stack provider to open a PR. Use when an agy task is done and the user wants its changes, or before opening a PR from agy's work."
argument-hint: '--task <localId>'
allowed-tools:
  - Bash
---

# Collect an agy Task's Work

Writes `commits.patch` (from `git format-patch`) and `uncommitted.patch`
(staged, unstaged and untracked changes) under the data dir's
`artifacts/<localId>/`. The worktree, branch and real index are left as they
are. Ignored files are never collected. A nested git repository refuses the
collect, because a patch can't carry it.

## Workflow

### Step 1: Validate Arguments

Accept `--task <localId>` once, matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.

### Step 2: Collect

Replace the `YELLOW_TODO_` token inside its single quotes:

```bash
set -uo pipefail
TASK='YELLOW_TODO_task'
case "$TASK" in *YELLOW_TODO_*) printf 'ERROR: substitute the placeholder.\n' >&2; exit 1 ;; esac
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-agy CLI not found at %s\n' "$CLI" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'ERROR: jq is required\n' >&2; exit 1; }
OUT=$(node "$CLI" collect --task "$TASK")
printf 'exit=%s\n' "$?"
printf '%s\n' "$OUT" | jq '{ok, error: (.error | if . then {code, message, recoveryAction} else null end), localId, commitCount, commitsPatch, uncommittedPatch, secretShapedContent}'
```

### Step 3: Report

Give the patch paths and the commit count. When `secretShapedContent` is
true, say that the owner must review the patches before any PR is opened, and
don't apply or push them yourself. Otherwise, the owner's stack provider
(`/stack:status`, then its submit command) turns the patches into a PR; agy
itself never pushes.
