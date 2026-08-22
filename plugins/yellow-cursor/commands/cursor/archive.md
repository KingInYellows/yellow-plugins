---
name: cursor:archive
description: 'Archive a Cursor Cloud Agent to hide it from default listing, after user confirmation. Use when user wants to clean up old Cursor agents, says "archive that agent", or "hide that Cursor session".'
argument-hint: '--agent-id <id> [--force]'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Archive a Cursor Cloud Agent

Archiving hides the agent from `/cursor:list`'s default view. It does not delete
it — no delete operation exists anywhere in this CLI surface.

## Workflow

### Step 1: Validate Prerequisites

```bash
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
if [ ! -f "$CLI" ]; then
  printf 'ERROR: yellow-cursor CLI not found at %s. Reinstall the plugin or report a bug.\n' "$CLI" >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n' >&2
  exit 1
}
```

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for `--agent-id <id>` (required). If missing, ask via
AskUserQuestion (suggest `/cursor:list` to find one).

### Step 3: Confirm

AskUserQuestion:

- "Archive Cursor agent `<id>`? It will be hidden from default `/cursor:list`
  output. This does not delete it."
- Options: "Yes, archive" / "No, cancel"

If declined, stop.

### Step 4: Archive (without `--force` first)

```bash
args=(archive --agent-id "$AGENT_ID" --yes)
OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
CODE=$(printf '%s' "$OUTPUT" | jq -r '.error.code // empty')
```

Do not pass `--force` on this first attempt even if the user included it in
`$ARGUMENTS` up front — only use it reactively in Step 5, after the CLI itself
reports the agent is busy. This keeps `--force` a deliberate, in-the-moment
choice rather than a blanket default.

### Step 5: Handle Busy (reactive `--force`)

If `CODE` is `CURSOR_AGENT_BUSY` (the agent has an active run), ask via
AskUserQuestion:

- "Agent `<id>` has an active run. Force-archive anyway?"
- Options: "Yes, force archive" / "No, wait and try later"

On "Yes, force archive", re-run with `--force`:

```bash
args=(archive --agent-id "$AGENT_ID" --yes --force)
OUTPUT=$(node "$CLI" "${args[@]}")
```

### Step 6: Report

On `ok:true`, check `alreadyInState`:

- `true` — report "Agent `<id>` was already archived."
- `false` — report "Agent `<id>` archived."

## Error Handling

| Code                           | Retryable | Recovery Action                                                                                   |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `CURSOR_CONFIRMATION_REQUIRED` | false     | should not occur (this command always passes `--yes` after confirming) — if seen, report as a bug |
| `CURSOR_AGENT_BUSY`            | true      | wait for the current run, or offer `--force` per Step 5                                           |
| `CURSOR_NOT_FOUND`             | false     | verify the agent id via `/cursor:list`                                                            |
| `CURSOR_AUTH_FAILED`           | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                                                       |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
