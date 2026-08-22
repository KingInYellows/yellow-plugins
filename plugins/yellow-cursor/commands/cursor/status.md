---
name: cursor:status
description: 'Check the live status of a Cursor Cloud Agent (and optionally a specific run), reconciling local state against the server. Use when user asks how a Cursor agent is doing, wants to check agent status, or after CURSOR_UNKNOWN_OUTCOME / CURSOR_STATE_CORRUPT.'
argument-hint: '--agent-id <id> [--run-id <id>] [--reconcile]'
allowed-tools:
  - Bash
---

# Check Cursor Agent Status

Always re-fetches live from the SDK (`Agent.get`, plus `Agent.getRun` if
`--run-id` is given) and opportunistically reconciles the matching local record.

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

Parse `$ARGUMENTS` for `--agent-id <id>` (required), `--run-id <id>` (optional),
`--reconcile` (optional flag).

If `--agent-id` is missing, do not guess — report that it's required and suggest
`/cursor:list` to find one, then stop.

### Step 3: Run

```bash
args=(status --agent-id "$AGENT_ID")
[ -n "$RUN_ID" ] && args+=(--run-id "$RUN_ID")
[ "$RECONCILE" = "1" ] && args+=(--reconcile)

OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 4: Report

On `ok:true`, report from the JSON: `agentId`, `agentStatus`, `archived`,
`repository`, and if `--run-id` was given, the `run` block (`id`, `status`,
`requestId`, `targetBranch`, `pullRequestUrl`, `result`, `errorMessage`).

`drift` is only present when a local record existed to compare against. If
`drift:true`, tell the user the local index had disagreed with the live state —
this call already re-fetched and (if `--reconcile` was passed) corrected it.

Use `--reconcile` after a `CURSOR_STATE_CORRUPT` quarantine or a
`CURSOR_UNKNOWN_OUTCOME` from `/cursor:delegate` or `/cursor:follow-up` — it
widens local-record matching to include the stored idempotency key, not just
agent id.

## Error Handling

| Code                   | Retryable | Recovery Action                                                         |
| ---------------------- | --------- | ----------------------------------------------------------------------- |
| `CURSOR_NOT_FOUND`     | false     | verify the agent/run id, e.g. via `/cursor:list`                        |
| `CURSOR_STATE_CORRUPT` | false     | the local index was quarantined; re-run this command with `--reconcile` |
| `CURSOR_AUTH_FAILED`   | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                             |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
