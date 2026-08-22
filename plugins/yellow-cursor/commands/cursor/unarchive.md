---
name: cursor:unarchive
description: "Restore an archived Cursor Cloud Agent to default listing, after user confirmation. Use when user wants to bring back a previously archived Cursor agent."
argument-hint: '--agent-id <id>'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Unarchive a Cursor Cloud Agent

Mirror of `/cursor:archive` — restores an archived agent to `/cursor:list`'s
default view.

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

Parse `$ARGUMENTS` for `--agent-id <id>` (required). **Validate the value
against `^bc-[0-9a-fA-F-]{1,64}$` before using it anywhere**, and reject any
argument other than `--agent-id` and its value — never pass an unvalidated
`$ARGUMENTS` fragment to the CLI. (The CLI validates again, but a malformed id
should be refused here rather than round-tripped.)

If the id is missing or fails that check, suggest `/cursor:list --archived`,
which includes archived agents in its listing and is the discovery path for an
id the user no longer has. `/cursor:status --agent-id <id>` also works when the
id is already known. Otherwise ask via AskUserQuestion.

### Step 3: Confirm

AskUserQuestion:

- "Unarchive Cursor agent `<id>`? It will reappear in default `/cursor:list`
  output."
- Options: "Yes, unarchive" / "No, cancel"

If declined, stop.

### Step 4: Unarchive

```bash
args=(unarchive --agent-id "$AGENT_ID" --yes)
OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 5: Report

On `ok:true`, check `alreadyInState`:

- `true` — report "Agent `<id>` was not archived; nothing to do."
- `false` — report "Agent `<id>` unarchived."

## Error Handling

| Code                           | Retryable | Recovery Action                                                                                   |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `CURSOR_CONFIRMATION_REQUIRED` | false     | should not occur (this command always passes `--yes` after confirming) — if seen, report as a bug |
| `CURSOR_NOT_FOUND`             | false     | verify the agent id                                                                               |
| `CURSOR_AUTH_FAILED`           | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                                                       |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
