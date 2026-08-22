---
name: cursor:delegate
description: 'Launch a Cursor Cloud Agent against a repository with a task prompt, always dry-run validated and user-confirmed before the billable launch. Use when user says "have Cursor do X", "send this to Cursor", or "delegate to Cursor".'
argument-hint: '--repo <url> --prompt <text> [--ref <ref>] [--model <id>] [--idempotency-key <key>] [--max-active <n>] [--no-auto-create-pr] [--linear-issue <id>] [--calling-host <name>]'
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Delegate Task to a Cursor Cloud Agent

Create a new Cursor Cloud Agent run against a repository. **This launches a paid
Cursor Cloud Agent** — every launch is dry-run validated, displayed to the user,
and explicitly confirmed before any network call that could spend money.

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

Parse `$ARGUMENTS`:

- `--repo <url>` (required) — must be `https://`, host in
  `github.com`/`gitlab.com`/`dev.azure.com`/`bitbucket.org`, no userinfo, no
  fragment. Let the CLI do the actual validation; do not pre-filter beyond basic
  presence.
- `--prompt <text>` (required)
- `--ref <ref>` (optional starting ref)
- `--model <id>` (optional)
- `--idempotency-key <key>` (optional — see Step 3 if omitted)
- `--max-active <n>` (optional, CLI default 3)
- `--no-auto-create-pr` (optional flag)
- `--linear-issue <id>` (optional, pass-through metadata)
- `--calling-host <name>` (optional, pass-through metadata — e.g. set by
  `/linear:delegate` when it calls through to this command)

If `--repo` or `--prompt` is missing, ask via AskUserQuestion rather than
guessing.

### Step 3: Dry-Run Validate (always, zero network)

Build the argument array — never string-interpolate into the shell:

```bash
args=(delegate --repo "$REPO" --prompt "$PROMPT" --dry-run)
[ -n "$REF" ] && args+=(--ref "$REF")
[ -n "$MODEL" ] && args+=(--model "$MODEL")
[ -n "$IDEMPOTENCY_KEY" ] && args+=(--idempotency-key "$IDEMPOTENCY_KEY")
[ -n "$MAX_ACTIVE" ] && args+=(--max-active "$MAX_ACTIVE")
[ "$NO_AUTO_CREATE_PR" = "1" ] && args+=(--no-auto-create-pr)
[ -n "$LINEAR_ISSUE" ] && args+=(--linear-issue "$LINEAR_ISSUE")
[ -n "$CALLING_HOST" ] && args+=(--calling-host "$CALLING_HOST")

OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
IDEMPOTENCY_KEY=$(printf '%s' "$OUTPUT" | jq -r '.idempotencyKey')
```

`idempotencyKey` is always present in the response — on success **and** on every
failure path — whether the caller supplied `--idempotency-key` or the CLI
generated one via `crypto.randomUUID()`. **Capture it here even if this command
wasn't given one.** From this point forward, every subsequent invocation for
this same delegation attempt — the real launch in Step 5, and any retry after a
failed launch — MUST pass this exact same `--idempotency-key`. Never mint or
accept a different key partway through one delegation attempt; that is what lets
the CLI recognize a retry as the same operation instead of a second paid launch.

If `ok:false` at this stage, the plan itself is invalid (e.g.
`CURSOR_INVALID_INPUT`) — report the error and stop. Do not proceed to
confirmation.

### Step 4: Display Plan and Confirm

From the dry-run's `ok:true` response, show the user:

- **Repository:** `repository`
- **Starting ref:** `startingRef` (if set)
- **Model:** `model` (if set, else "Cursor default")
- **Billing:** "This launches a paid Cursor Cloud Agent run."

Then AskUserQuestion:

- "Launch this Cursor Cloud Agent now?"
- Options: "Yes, launch" / "No, cancel"

If the user declines, stop. Tell them the idempotency key (`$IDEMPOTENCY_KEY`)
is safe to reuse if they want to launch this exact task later — do not discard
it as though it were single-use.

### Step 5: Real Launch

Immediately after confirmation (no delay, no re-prompting), re-run with the
**same** argument set, dropping `--dry-run` and adding `--yes`:

```bash
args=(delegate --repo "$REPO" --prompt "$PROMPT" --yes --idempotency-key "$IDEMPOTENCY_KEY")
[ -n "$REF" ] && args+=(--ref "$REF")
[ -n "$MODEL" ] && args+=(--model "$MODEL")
[ -n "$MAX_ACTIVE" ] && args+=(--max-active "$MAX_ACTIVE")
[ "$NO_AUTO_CREATE_PR" = "1" ] && args+=(--no-auto-create-pr)
[ -n "$LINEAR_ISSUE" ] && args+=(--linear-issue "$LINEAR_ISSUE")
[ -n "$CALLING_HOST" ] && args+=(--calling-host "$CALLING_HOST")

OUTPUT=$(node "$CLI" "${args[@]}")
OK=$(printf '%s' "$OUTPUT" | jq -r '.ok')
```

### Step 6: Report

On `ok:true`, report only fields present in the JSON: `agentId`, `runId`,
`requestId`, `status`, `repository`, `startingRef`, `targetBranch`,
`pullRequestUrl`, `model`. Do not fabricate a `targetBranch` or `pullRequestUrl`
if absent — Cursor may not have created one yet.

On `ok:false`, see Error Handling. **Never automatically re-invoke delegate on
failure** — report the error and let the user decide, always quoting the same
`idempotencyKey` for whatever they do next.

## Error Handling

| Code                           | Retryable | Recovery Action                                                                                                                                                                                                                                    |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CURSOR_CONFIRMATION_REQUIRED` | false     | should not occur (this command always passes `--yes` after confirming) — if seen, report as a bug                                                                                                                                                  |
| `CURSOR_DUPLICATE_LAUNCH`      | false     | check `/cursor:status --agent-id <id> --reconcile` instead of relaunching — find `<id>` via `/cursor:list` (matches by idempotency key)                                                                                                            |
| `CURSOR_NESTED_DELEGATION`     | false     | refuse; this session is already running inside a remote-agent context — delegate from a normal session instead                                                                                                                                     |
| `CURSOR_CONCURRENCY_LIMIT`     | false     | quote the JSON's own `error.recoveryAction` — usually "wait for an active run to finish, or re-run with a higher `--max-active`", but the page-bound variant overrides it with guidance that raising the cap cannot help                            |
| `CURSOR_AUTH_FAILED`           | false     | set `CURSOR_API_KEY` or run `/cursor:setup`                                                                                                                                                                                                        |
| `CURSOR_REPO_ACCESS`           | false     | connect the repo's SCM integration in Cursor, then retry with the same `--idempotency-key`                                                                                                                                                         |
| `CURSOR_RATE_LIMITED`          | true      | wait and retry later with the same `--idempotency-key`                                                                                                                                                                                             |
| `CURSOR_SERVICE_UNAVAILABLE`   | true      | retry later with the same `--idempotency-key`                                                                                                                                                                                                      |
| `CURSOR_INVALID_INPUT`         | false     | fix the flagged input and retry                                                                                                                                                                                                                    |
| `CURSOR_MALFORMED_RESPONSE`    | false     | report to the user; retry with the same `--idempotency-key` or report a bug                                                                                                                                                                        |
| `CURSOR_UNKNOWN_OUTCOME`       | false     | **do not retry.** The dispatch may or may not have created a run server-side. Run `/cursor:list` to find the agent by this `idempotencyKey`, then `/cursor:status --agent-id <id> --reconcile` to learn the true state before doing anything else. |

Every error response still carries `idempotencyKey` — always surface it to the
user so a future retry (theirs, not this command's) reuses it.
