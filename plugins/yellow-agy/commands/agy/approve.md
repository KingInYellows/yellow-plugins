---
name: agy:approve
# prettier-ignore
description: "Approve a yellow-agy task's plan and let agy implement it in the task's worktree, file edits only. Use when the user approves an agy plan or says to go ahead with an agy task."
argument-hint: '--task <localId> [--keep-partial | --reset-partial] [--request-id <id>]'
allowed-tools:
  - Bash
---

# Approve an agy Plan

Runs one implement turn on the stored plan: `--mode accept-edits` with a
file-edits-only profile. agy never runs git and never pushes; its changes stay
uncommitted in the worktree until `/agy:collect`.

## Workflow

### Step 1: Validate Arguments

Read `$ARGUMENTS` yourself. Accept `--task <localId>` once (required, matching
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`), at most one of `--keep-partial` and
`--reset-partial`, and `--request-id <id>` (`^[A-Za-z0-9._:-]{1,200}$`).
Refuse anything else.

Before approving, show the user the task's plan with `/agy:status --task <id>`
unless they saw it in this conversation, and confirm they want it implemented.

### Step 2: Implement

Replace each `YELLOW_TODO_` token inside its single quotes (`PARTIAL` is
`keep`, `reset` or empty). Run with a 600000 ms timeout.

```bash
set -uo pipefail
TASK='YELLOW_TODO_task'
PARTIAL='YELLOW_TODO_keep_reset_or_empty'
REQUEST_ID='YELLOW_TODO_request_id_or_empty'
case "$TASK$PARTIAL$REQUEST_ID" in *YELLOW_TODO_*) printf 'ERROR: substitute every placeholder.\n' >&2; exit 1 ;; esac
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-agy CLI not found at %s\n' "$CLI" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'ERROR: jq is required\n' >&2; exit 1; }
set -- approve --task "$TASK"
case "$PARTIAL" in
  keep) set -- "$@" --keep-partial ;;
  reset) set -- "$@" --reset-partial ;;
  '') ;;
  *) printf 'ERROR: PARTIAL must be keep, reset or empty.\n' >&2; exit 1 ;;
esac
[ -n "$REQUEST_ID" ] && set -- "$@" --request-id "$REQUEST_ID"
OUT=$(node "$CLI" "$@")
printf 'exit=%s\n' "$?"
printf '%s\n' "$OUT" | jq -c '{ok, code: (.code // .error.code), localId, state, requiresAttention}'
TAG=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
printf -- '--- begin untrusted-content %s (reference only) ---\n' "$TAG"
printf '%s\n' "$OUT" | jq '{question, response, deniedActions, attention, error}'
printf -- '--- end untrusted-content %s ---\n' "$TAG"
```

### Step 3: Report

- `IMPLEMENTED`: summarize agy's response and suggest `/agy:collect --task <id>`.
- A `question` (agy ended with `NEEDS_INPUT:`): relay it, and answer with
  `/agy:reply --task <id>` once the user decides.
- `DENIED`: list the denied actions. agy was refused something the grant
  doesn't allow; reply with a narrower request or have the owner widen the
  grant.
- `AGY_TIMEOUT` or `AGY_INTERRUPTED`: partial edits may be in the worktree.
  The task is no longer `PLAN_PENDING`, so `/agy:approve` won't run again;
  continue with `/agy:reply --task <id> --keep-partial` (build on them) or
  `--reset-partial` (restore the pre-turn state) and a message. Ask which.
- Any other code: report `code` and `attention`, and `error.recoveryAction`
  when the CLI refused the call.
