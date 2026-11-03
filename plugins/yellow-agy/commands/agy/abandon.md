---
name: agy:abandon
# prettier-ignore
description: "Give the owner the terminal command that abandons a yellow-agy task: it collects the work first, removes the worktree and keeps the branch. Use when the user wants to drop or clean up an agy task."
argument-hint: '--task <localId>'
allowed-tools:
  - Bash
---

# Abandon an agy Task

Abandon removes a worktree, so the owner confirms it by typing a code in
their own terminal. This session has no terminal of its own and can't run it.
The command collects the task's work into `artifacts/<localId>/` first, so
nothing is lost, and the branch is kept.

## Workflow

### Step 1: Validate Arguments

Accept `--task <localId>` once, matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.
Refuse anything else, including a value with a quote, space or `$`: the
printed command puts it inside single quotes.

### Step 2: Print the Command

Replace the `YELLOW_TODO_` token inside its single quotes:

```bash
set -uo pipefail
TASK='YELLOW_TODO_task'
case "$TASK" in *YELLOW_TODO_*) printf 'ERROR: substitute the placeholder.\n' >&2; exit 1 ;; esac
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-agy CLI not found at %s\n' "$CLI" >&2; exit 1; }
printf "node '%s' abandon --task '%s'\n" "$CLI" "$TASK"
```

### Step 3: Report

Show the printed command and ask the owner to run it in a separate terminal on
this machine, then check the result with `/agy:status --task <id>`.
