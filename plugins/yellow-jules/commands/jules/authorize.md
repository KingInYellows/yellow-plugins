---
name: jules:authorize
# prettier-ignore
description: "List or revoke Google Jules grants, or prepare the terminal command that writes a new grant or moves the controller to this host. Use when the user wants to see what Jules may do unattended, revoke a grant, or authorize Jules to work on a branch."
argument-hint:
  '--list | --revoke <grant-id> | --repo <owner/repo> --branch <ref|pattern>
  --task-ref <id> --operations <create,reply,approve,collect> --owner <name>
  [--max-active-sessions <n>] [--max-total-tasks <n>] [--max-corrective-rounds
  <n>] [--ttl-minutes <n>] | --take-over'
allowed-tools:
  - Bash
---

# Authorize Jules

A grant is a bounded, expiring permission: one repository, a branch or branch
prefix, named task refs, a subset of `create`, `reply`, `approve`, `collect`,
and limits on sessions, tasks, and corrective rounds. A supervised session may
act without asking only inside a grant.

**Writing a grant cannot be done from this session.** `authorize` opens the
terminal itself, prints the grant, and requires the owner to type back a random
code. A process without a controlling terminal — this session included — is
refused with `JULES_CONFIRMATION_REQUIRED`. That is the point: the owner, not
the agent, widens what the agent may do. Listing and revoking never widen
anything, so those run directly.

Defaults: 1 active session, 3 tasks, 2 corrective rounds, 120 minutes. Ceilings:
3 active sessions, 10 tasks, 3 corrective rounds, 24 hours (1440 minutes).

## Workflow

### Step 1: Validate Arguments

Read `$ARGUMENTS` yourself — never paste its raw text into Bash source. Accept
exactly one mode and refuse anything else, quoting the offending fragment back:

- `--list`, no value
- `--revoke <grant-id>`, where the id matches `^jg-[0-9a-f]{32}$`
- `--take-over`, no value
- creation: `--repo <owner/repo>` matching
  `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$`;
  `--branch <ref|pattern>` matching `^[A-Za-z0-9._/-]{1,199}\*?$` (one trailing
  `*` allowed, never `*` alone); one or more `--task-ref <id>` matching
  `^[A-Za-z0-9._:-]{1,200}$`; `--operations` a comma list from
  `create,reply,approve,collect`; `--owner` matching
  `^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$`; optional `--max-active-sessions` (1-3),
  `--max-total-tasks` (1-10), `--max-corrective-rounds` (0-3), `--ttl-minutes`
  (1-1440), and `--source <resource>` for a pinned source

If nothing was given, run `--list`.

### Step 2a: List or Revoke

Run directly. Replace `YELLOW_TODO_grant_id` inside the single quotes only, and
only for `--revoke`:

```bash
set -uo pipefail
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-jules CLI not found at %s. Reinstall the plugin.\n' "$CLI" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n' >&2; exit 1; }
MODE='YELLOW_TODO_list_or_revoke'
GRANT_ID='YELLOW_TODO_grant_id_or_empty'
if [ "$MODE" = "revoke" ]; then
  OUTPUT=$(node "$CLI" authorize --revoke "$GRANT_ID")
else
  OUTPUT=$(node "$CLI" authorize --list)
fi
printf 'exit=%s\n' "$?"
printf '%s\n' "$OUTPUT" | jq '{ok, operation, grantId, revokedAt, grants: (if .grants then [.grants[] | {grantId, repository, branchPattern, taskRefs, operations, expiresAt, expired, revoked, controllerId, limits: {maxActiveSessions, maxTotalTasks, maxCorrectiveRounds}, usage: {activeSessions: (.usage.activeSessionRefs | length), totalTasks: .usage.totalTasks, correctiveRounds: .usage.correctiveRounds}}] else null end), error: (if .error then {code: .error.code, message: .error.message, recoveryAction: .error.recoveryAction, retryable: .error.retryable} else null end)} | with_entries(select(.value != null))'
```

Render grants as a table. A revoked or expired grant is shown as such. Revoking
is immediate and cannot be undone; the remote sessions it covered keep running.

### Step 2b: Create or Take Over

Do not run `authorize` for these. Print the exact command for the owner to run
in **a separate terminal window on this machine** — not through Claude Code,
whose own input handling would swallow the confirmation code. Replace each
`YELLOW_TODO_` token inside its single quotes with the validated value; repeat
the `--task-ref` pair per task; drop optional flags that were not given.

```bash
set -uo pipefail
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
REPO='YELLOW_TODO_repo'
BRANCH='YELLOW_TODO_branch_or_pattern'
OPERATIONS='YELLOW_TODO_operations'
OWNER='YELLOW_TODO_owner'
printf 'Run this yourself in a separate terminal on the controller host:\n\n'
printf '  node %s authorize --repo %s --branch %s --task-ref %s --operations %s --owner %s\n\n' "'$CLI'" "'$REPO'" "'$BRANCH'" "'YELLOW_TODO_task_ref'" "'$OPERATIONS'" "'$OWNER'"
printf 'It prints the grant and a six-character code. Type the code to write the grant.\n'
printf 'Then give me the grant id from its output, or run /jules:authorize --list.\n'
```

For `--take-over` print `node '<CLI>' authorize --take-over`. It advances the
controller epoch for this host and data directory and rebinds every grant; run
it only as step 5 of the handoff procedure in this plugin's `CLAUDE.md`.

## Error Handling

| Code                          | Retryable | Recovery Action                                                                         |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `JULES_CONFIRMATION_REQUIRED` | false     | expected from this session; run the printed command yourself in a terminal              |
| `JULES_AUTHORITY_DENIED`      | false     | the code did not match, or the call came from inside a supervised session               |
| `JULES_NOT_FOUND`             | false     | no such grant; list grants with `--list`                                                |
| `JULES_INVALID_INPUT`         | false     | fix the flagged input; limits above the ceilings are refused                            |
| `JULES_CONTROLLER_MISMATCH`   | false     | this data directory is not the authorized controller copy; follow the handoff procedure |
| `JULES_JOURNAL_CORRUPT`       | false     | repair `state/grants.json` by hand; grants are never treated as empty                   |
| `JULES_DATA_DIR`              | false     | fix the data directory or controller directory permissions reported in the error        |
| `JULES_SOURCE_ACCESS`         | false     | connect the repository to Jules, then retry                                             |
| `JULES_AUTH_FAILED`           | false     | set `JULES_API_KEY`, then run `/jules:setup`                                            |

Any other `error.code`: report it with its recovery action.
