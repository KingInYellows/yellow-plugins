---
name: cursor:list
description: 'List Cursor Cloud Agents merged with local state. Use when user asks "what Cursor agents are running", "show my Cursor sessions", or wants to find an agent id for status/cancel/archive.'
argument-hint: '[--cursor <token>] [--archived]'
allowed-tools:
  - Bash
---

# List Cursor Cloud Agents

Show one page of agents from `Agent.list()`, merged with the local index
(matched by idempotency key, falling back to agent id). Archived agents are
excluded unless `--archived` is passed — that is what makes `/cursor:archive`
actually hide an agent.

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

### Step 2: Run

```bash
args=(list)
[ -n "$CURSOR_TOKEN" ] && args+=(--cursor "$CURSOR_TOKEN")
[ -n "$SHOW_ARCHIVED" ] && args+=(--archived)

OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

`$CURSOR_TOKEN` here is the pagination cursor parsed from an optional
`--cursor <token>` in `$ARGUMENTS` — unrelated to `CURSOR_API_KEY`.
`$SHOW_ARCHIVED` is set non-empty only when `$ARGUMENTS` contained `--archived`.
Both are parsed and assigned in this same Bash block — shell variables do not
persist across separate Bash calls.

If `items` is empty without `--archived`, mention that archived agents were
excluded before concluding the account has no agents.

### Step 3: Report

On `ok:true`, render `items` as a table:

```text
Agent ID       | Status    | Archived | Repository                  | Drift
abc123...      | running   | false    | github.com/org/repo         | false
def456...      | finished  | true     | github.com/org/other-repo   | true
```

`drift:true` means the local index disagreed with the live fetch for that item —
suggest `/cursor:status --agent-id <id> --reconcile` for those rows.

If `nextCursor` is present, tell the user they can re-run
`/cursor:list --cursor <nextCursor>` to see the next page — do not
auto-paginate.

If `items` is empty, report "No Cursor agents found."

## Error Handling

| Code                         | Retryable | Recovery Action                             |
| ---------------------------- | --------- | ------------------------------------------- |
| `CURSOR_AUTH_FAILED`         | false     | set `CURSOR_API_KEY` or run `/cursor:setup` |
| `CURSOR_RATE_LIMITED`        | true      | wait and retry                              |
| `CURSOR_SERVICE_UNAVAILABLE` | true      | retry later                                 |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
