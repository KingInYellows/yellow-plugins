---
name: cursor:artifacts
description: 'List or download artifacts produced by a Cursor Cloud Agent run. Use when user asks "what did Cursor produce", "show artifacts", or wants to download a specific output file.'
argument-hint: '--agent-id <id> [--download <remote-path> --out <local-path>]'
allowed-tools:
  - Bash
---

# Cursor Cloud Agent Artifacts

Lists artifacts by default. Downloads only when the user explicitly names a
remote path and a local destination — this command never guesses a download
target.

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

Parse `$ARGUMENTS` for `--agent-id <id>` (required). If the user also gave
`--download <remote-path>`, they must also give `--out <local-path>` — pass both
through to the CLI verbatim; do not attempt to pre-validate the paths here (the
CLI enforces relative-only, no `..` segments, no control characters, and refuses
a symlink at the destination).

If `--agent-id` is missing, report that it's required (suggest `/cursor:list`)
and stop.

### Step 3: Run

List mode:

```bash
args=(artifacts --agent-id "$AGENT_ID")
OUTPUT=$(node "$CLI" "${args[@]}")
```

Download mode (only when both `--download` and `--out` were given). `--out`
must be a **relative** path (no leading `/` or `..` segments); the CLI resolves
it under `${YELLOW_CURSOR_DATA_DIR}/artifact-downloads/` (or the default
data-dir when unset) and refuses escapes outside that directory.

```bash
args=(artifacts --agent-id "$AGENT_ID" --download "$REMOTE_PATH" --out "$LOCAL_PATH")
OUTPUT=$(node "$CLI" "${args[@]}")
```

### Step 4: Report

List mode, on `ok:true`: render `items` as a table of `path`, `sizeBytes`,
`updatedAt`. If empty, report "No artifacts found for this agent."

Download mode, on `ok:true`: report `downloaded.remotePath`,
`downloaded.localPath`, `downloaded.bytes`.

## Error Handling

| Code                            | Retryable | Recovery Action                                                      |
| ------------------------------- | --------- | -------------------------------------------------------------------- |
| `CURSOR_UNSUPPORTED_CAPABILITY` | false     | artifacts aren't available for this SDK/account — no retry will help |
| `CURSOR_INVALID_INPUT`          | false     | `--download` without `--out`, or a rejected path — fix and retry     |
| `CURSOR_NOT_FOUND`              | false     | verify the agent id via `/cursor:list`                               |
| `CURSOR_AUTH_FAILED`            | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                          |

Any other `error.code` — report the code, message, and `error.recoveryAction`
from the JSON as-is.
