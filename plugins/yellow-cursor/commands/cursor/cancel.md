---
name: cursor:cancel
description: 'Cancel a running Cursor Cloud Agent run after user confirmation. Use when user wants to stop a Cursor agent, says "cancel Cursor", "stop that run", or "kill that task".'
argument-hint: '--run-id <id> --agent-id <id>'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Cancel a Cursor Cloud Agent Run

Terminate a run after confirmation. The CLI itself re-fetches the run
immediately before acting (TOCTOU-safe) — an already-terminal run is reported
back as a no-op, not an error.

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

Parse `$ARGUMENTS` for `--run-id <id>` and `--agent-id <id>` (both required). If
either is missing, ask via AskUserQuestion.

### Step 3: Show Current Status (read-only)

Before asking for confirmation, fetch the run's current status so the
confirmation prompt is grounded in real state:

```bash
args=(status --agent-id "$AGENT_ID" --run-id "$RUN_ID")
OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
RUN_STATUS=$(printf '%s' "$OUTPUT" | jq -r '.run.status // "unknown"')
```

If this lookup fails with `CURSOR_NOT_FOUND`, report that and stop — there is
nothing to cancel.

### Step 4: Confirm

AskUserQuestion:

- "Cancel run `<run-id>` on agent `<agent-id>`? Current status: `<RUN_STATUS>`."
- Options: "Yes, cancel" / "No, keep running"

If declined, stop without cancelling.

### Step 5: Cancel

```bash
args=(cancel --run-id "$RUN_ID" --agent-id "$AGENT_ID" --yes)
OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 6: Report

On `ok:true`, check `alreadyTerminal`:

- `true` — report "Run was already `<status>` — nothing to cancel." This is a
  successful, idempotent response, not an error.
- `false` — report "Run cancelled." with the new `status`.

## Error Handling

| Code                           | Retryable | Recovery Action                                                                                   |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `CURSOR_CONFIRMATION_REQUIRED` | false     | should not occur (this command always passes `--yes` after confirming) — if seen, report as a bug |
| `CURSOR_NOT_FOUND`             | false     | verify the agent/run id via `/cursor:list` or `/cursor:status`                                    |
| `CURSOR_AUTH_FAILED`           | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                                                       |
| `CURSOR_RATE_LIMITED`          | true      | wait and retry                                                                                    |
| `CURSOR_SERVICE_UNAVAILABLE`   | true      | retry later                                                                                       |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
