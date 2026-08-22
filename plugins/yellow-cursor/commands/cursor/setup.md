---
name: cursor:setup
description: "Detect Cursor SDK/credential availability and optionally install the @cursor/sdk runtime. Use when first installing yellow-cursor, after CURSOR_API_KEY changes, or when cursor commands fail with CURSOR_SDK_MISSING."
argument-hint: '[--install-sdk]'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Set Up yellow-cursor

Probe credential and SDK resolution for the Cursor Cloud Agent CLI, and
optionally install the pinned `@cursor/sdk` runtime.

## Background

- Credentials are resolved by the CLI in this order: `CURSOR_API_KEY` env, then
  a Cursor stored login (`~/.cursor/sdk/auth.json`). Auth is **never** read from
  command-line arguments. This command never prints the value of
  `CURSOR_API_KEY` or any credential — only `credentialSource`
  (`env`/`stored-login`/`none`).
- `sdkResolution` reports where `@cursor/sdk` was found: `workspace`, `data-dir`
  (installed via `--install-sdk` into the plugin's data directory), or
  `missing`.
- `--install-sdk` runs
  `npm install --prefix <dataDir>/runtime @cursor/sdk@1.0.28` (exact pin) before
  probing.

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

Parse `$ARGUMENTS` for an explicit `--install-sdk` flag. If present, include it
on the first run below instead of waiting for Step 4's offer.

### Step 3: Run Setup

```bash
args=(setup)
[ "$INSTALL_SDK_REQUESTED" = "1" ] && args+=(--install-sdk)

OUTPUT=$(node "$CLI" "${args[@]}")
EXIT_CODE=$?
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 4: Report and Offer Install

On `ok:true`, report from the JSON only:

- `credentialSource` (`env` / `stored-login` / `none`)
- `sdkResolution` (`workspace` / `data-dir` / `missing`)
- `me.email` if present
- `modelsCount` — `{supported:true, value:N}` or `{supported:false, reason}`
- `installed.runtimeDir` if `--install-sdk` ran this pass

If `sdkResolution` is `missing` and this pass did **not** already run
`--install-sdk`, use AskUserQuestion:

- "The `@cursor/sdk` runtime could not be resolved. Install it now via
  `npm install --prefix <dataDir>/runtime @cursor/sdk@1.0.28`?"
- Options: "Yes, install" / "No, skip"

On "Yes, install", re-run Step 3 with `args=(setup --install-sdk)` and report
the result, including `installed.runtimeDir`.

If `credentialSource` is `none`, tell the user to set `CURSOR_API_KEY` in their
environment or authenticate via the Cursor CLI's own stored-login flow — do not
attempt to log in on their behalf.

### Step 5: Handle Failure

On `ok:false`, read `error.code`, `error.message`, `error.retryable`,
`error.recoveryAction` from the JSON and report them verbatim — do not
paraphrase away the recovery action.

## Error Handling

| Code                         | Retryable | Recovery Action                                            |
| ---------------------------- | --------- | ---------------------------------------------------------- |
| `CURSOR_INVALID_INPUT`       | false     | fix input and retry (e.g. malformed `--install-sdk` usage) |
| `CURSOR_SERVICE_UNAVAILABLE` | true      | retry later (npm install network failure)                  |
| `CURSOR_SDK_MISSING`         | false     | re-run `/cursor:setup --install-sdk`                       |

Any other `error.code` — report the code, message, and recovery action from the
JSON as-is; do not invent handling for codes not observed.
