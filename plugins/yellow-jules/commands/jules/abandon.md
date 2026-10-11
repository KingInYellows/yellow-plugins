---
name: jules:abandon
# prettier-ignore
description: "Prepare the terminal command that abandons a Google Jules launch or message whose outcome could not be determined, freeing its repository and branch guard. Use when status --reconcile left an operation ambiguous or not-reached and the user decides to give it up."
argument-hint: '--request-id <id>'
allowed-tools:
  - Bash
---

# Abandon an Unresolved Jules Operation

An operation whose outcome is unknown blocks a new launch for the same
repository and branch until it is resolved. `/jules:status --reconcile` resolves
most of them. When it leaves one `ambiguous-reconcile` or `not-reached`,
`abandon` marks it failed and frees the guard and the grant slot.

**Abandoning cannot be done from this session.** It widens what may run next, so
the CLI asks the owner to type back a random code on the terminal. A process
without a controlling terminal — this session included — is refused with
`JULES_CONFIRMATION_REQUIRED`. Jules may still hold a session for the abandoned
operation; abandoning does not stop it.

## Workflow

### Step 1: Validate Arguments

Read `$ARGUMENTS` yourself — never paste its raw text into Bash source. Accept
exactly one `--request-id <id>` matching `^[A-Za-z0-9._:-]{1,200}$` and refuse
anything else, quoting the offending fragment back. If it is missing, run
`/jules:status --reconcile` first and ask which operation to abandon.

### Step 2: Print the Command

Replace `YELLOW_TODO_request_id` inside the single quotes only:

```bash
set -uo pipefail
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
REQUEST_ID='YELLOW_TODO_request_id'
printf 'First make sure /jules:status --reconcile reports this operation as ambiguous-reconcile or not-reached.\n'
printf 'Then run this yourself in a separate terminal on the controller host:\n\n'
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
printf '  node %s abandon --request-id %s\n\n' "$(shq "$CLI")" "$(shq "$REQUEST_ID")"
printf 'It prints the operation and a six-character code. Type the code to confirm.\n'
```

## Error Handling

| Code                          | Retryable | Recovery Action                                                                                                       |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `JULES_CONFIRMATION_REQUIRED` | false     | expected from this session; run the printed command yourself in a terminal                                            |
| `JULES_AUTHORITY_DENIED`      | false     | the code did not match; nothing was changed                                                                           |
| `JULES_INVALID_STATE`         | false     | only an unresolved operation whose last reconcile was ambiguous or not-reached; run `/jules:status --reconcile` first |
| `JULES_NOT_FOUND`             | false     | no such request id; find it with `/jules:status --reconcile`                                                          |
| `JULES_CONTROLLER_MISMATCH`   | false     | this data directory is not the authorized controller copy                                                             |

Any other `error.code`: report it with its recovery action.
