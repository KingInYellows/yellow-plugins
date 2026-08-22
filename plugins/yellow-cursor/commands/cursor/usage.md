---
name: cursor:usage
description: 'Show token usage and cost for a Cursor Cloud Agent, broken down by run. Use when user asks "how much did this Cursor agent cost" or "show token usage".'
argument-hint: '--agent-id <id>'
allowed-tools:
  - Bash
---

# Cursor Cloud Agent Usage

Per-agent token usage and cost (no account-wide usage endpoint exists in the SDK
— this is scoped to one agent).

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

Parse `$ARGUMENTS` for `--agent-id <id>` (required). If missing, report that
it's required (suggest `/cursor:list`) and stop.

### Step 3: Run

```bash
args=(usage --agent-id "$AGENT_ID")
OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 4: Report

On `ok:true`, report `usage.usage` (token totals) and `usage.cost` if present,
then a per-run breakdown table from `usage.runs` (`runId`, `usage`, `cost`).

## Error Handling

| Code                            | Retryable | Recovery Action                                                 |
| ------------------------------- | --------- | --------------------------------------------------------------- |
| `CURSOR_UNSUPPORTED_CAPABILITY` | false     | usage isn't available for this SDK/account — no retry will help |
| `CURSOR_NOT_FOUND`              | false     | verify the agent id via `/cursor:list`                          |
| `CURSOR_AUTH_FAILED`            | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                     |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
