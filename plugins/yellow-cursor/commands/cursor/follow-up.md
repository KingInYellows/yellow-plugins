---
name: cursor:follow-up
description: "Send a follow-up prompt to an existing Cursor Cloud Agent, confirmed before the billable send. Use when user wants to continue or redirect a Cursor agent that is already running or finished."
argument-hint: '--agent-id <id> --prompt <text> [--idempotency-key <key>]'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Send a Follow-Up to a Cursor Cloud Agent

Continues an existing agent's conversation with a new prompt. This dispatches a
real message (billable) — always confirmed first. Unlike `/cursor:delegate`,
this subcommand has no `--dry-run`, so confirmation is based on a plain summary
rather than a CLI-validated plan.

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

Parse `$ARGUMENTS` for `--agent-id <id>` and `--prompt <text>` (both required),
and an optional `--idempotency-key <key>`. If either required value is missing,
ask via AskUserQuestion rather than guessing.

### Step 3: Confirm

Show the user: agent id, and the prompt text they're about to send. Then
AskUserQuestion:

- "Send this follow-up to Cursor agent `<id>`?"
- Options: "Yes, send" / "No, cancel"

If declined, stop.

### Step 4: Send

```bash
args=(follow-up --agent-id "$AGENT_ID" --prompt "$PROMPT" --yes)
[ -n "$IDEMPOTENCY_KEY" ] && args+=(--idempotency-key "$IDEMPOTENCY_KEY")

OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
IDEMPOTENCY_KEY=$(printf '%s' "$OUTPUT" | jq -r '.idempotencyKey')
```

Capture `idempotencyKey` from the response regardless of outcome — if
`--idempotency-key` wasn't supplied, the CLI generated one, and **any retry of
this same follow-up must reuse that exact value**, never a new one.

### Step 5: Report

On `ok:true`: report `agentId`, `runId`, `requestId`, `status`, `targetBranch`,
`pullRequestUrl` from the JSON only.

On `ok:false` with `CURSOR_INVALID_INPUT` and a message about the agent being
archived: tell the user to run `/cursor:unarchive --agent-id <id>` first, then
retry the follow-up.

On `ok:false` with `CURSOR_UNKNOWN_OUTCOME`: unlike delegate, the agent id is
already known here — run `/cursor:status --agent-id <id> --reconcile` to learn
the true state. **Do not retry the send automatically**; if the user wants to
retry, it must reuse `$IDEMPOTENCY_KEY`.

## Error Handling

| Code                           | Retryable | Recovery Action                                                                                   |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `CURSOR_CONFIRMATION_REQUIRED` | false     | should not occur (this command always passes `--yes` after confirming) — if seen, report as a bug |
| `CURSOR_INVALID_INPUT`         | false     | if the agent is archived, run `/cursor:unarchive` first; otherwise fix the flagged input          |
| `CURSOR_NOT_FOUND`             | false     | verify the agent id via `/cursor:list`                                                            |
| `CURSOR_NESTED_DELEGATION`     | false     | refuse; this session is already running inside a remote-agent context                             |
| `CURSOR_AUTH_FAILED`           | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                                                       |
| `CURSOR_RATE_LIMITED`          | true      | wait and retry later with the same `--idempotency-key`                                            |
| `CURSOR_SERVICE_UNAVAILABLE`   | true      | retry later with the same `--idempotency-key`                                                     |
| `CURSOR_UNKNOWN_OUTCOME`       | false     | run `/cursor:status --agent-id <id> --reconcile` before doing anything else; do not blindly retry |

Every error response still carries `idempotencyKey` — always surface it.
