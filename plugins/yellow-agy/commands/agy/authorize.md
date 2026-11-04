---
name: agy:authorize
# prettier-ignore
description: "List or revoke yellow-agy grants, or give the owner the terminal command that creates one (repo, branch pattern, operations, quota floor, limits, expiry). Use when a delegate is refused for want of a grant, or the user asks what agy is allowed to do."
argument-hint: '[--list | --revoke <grantId> | --repo <path> --branch <pattern> [--operations <ops>] [--allow-command <cmd>]... [--min-quota-percent <n>] [--max-tasks <n>] [--max-corrective-rounds <n>] [--ttl-minutes <n>]]'
allowed-tools:
  - Bash
---

# Manage yellow-agy Grants

A grant says which repo and branches agy may work on, which operations
(`create`, `approve`, `reply`, `collect`) are allowed, the AI Pro quota floor
(default 10%), how many tasks and corrective rounds it covers, and when it
expires (default 120 minutes, at most 24 hours). Creating one widens what agy
may do, so only the owner can, by typing a code shown in their own terminal.
Listing and revoking only read or narrow, so this session runs them.

`--allow-command` names a test or lint command (such as `pnpm test`). It is
used only on a host where agy's `--sandbox` is verified, which no host is yet,
so for now every run is file edits only.

## Workflow

### Step 1: Validate Arguments

Read `$ARGUMENTS` yourself. Exactly one mode:

- `--list`
- `--revoke <grantId>`, the id matching `^ag-[0-9a-f]{32}$`
- create: `--repo <absolute path>` and `--branch <pattern>` (an exact branch
  or a prefix ending in one `*`, never `*` alone), plus the optional flags in
  the argument hint. `--operations` defaults to `create,approve,reply,collect`.

Refuse anything else, and any value that contains a single quote.

### Step 2a: List or Revoke

Replace the `YELLOW_TODO_` token inside its single quotes (`MODE` is `list`
or a grant id to revoke):

```bash
set -uo pipefail
MODE='YELLOW_TODO_list_or_grant_id'
case "$MODE" in *YELLOW_TODO_*) printf 'ERROR: substitute the placeholder.\n' >&2; exit 1 ;; esac
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-agy CLI not found at %s\n' "$CLI" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf 'ERROR: jq is required\n' >&2; exit 1; }
if [ "$MODE" = list ]; then OUT=$(node "$CLI" authorize --list); else OUT=$(node "$CLI" authorize --revoke "$MODE"); fi
printf 'exit=%s\n' "$?"
printf '%s\n' "$OUT" | jq '{ok, error: .error.code, grantId, revokedAt, grants: [.grants[]? | {grantId, repo, branchPattern, operations, minQuotaPercent, tasks: "\(.totalTasks)/\(.maxTotalTasks)", expiresAt, expired, revoked}]}'
```

### Step 2b: Create

Print the command for the owner. Replace each `YELLOW_TODO_` token inside its
single quotes, writing each `'` in a value as `'\''`:

```bash
set -uo pipefail
REPO='YELLOW_TODO_repo'
BRANCH='YELLOW_TODO_branch_pattern'
OPS='YELLOW_TODO_operations_or_default'
case "$REPO$BRANCH$OPS" in *YELLOW_TODO_*) printf 'ERROR: substitute every placeholder.\n' >&2; exit 1 ;; esac
CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"
[ -f "$CLI" ] || { printf 'ERROR: yellow-agy CLI not found at %s\n' "$CLI" >&2; exit 1; }
[ "$OPS" = default ] && OPS=create,approve,reply,collect
# Each value goes inside single quotes on the owner's line, so escape any quote.
_q() { printf '%s' "$1" | sed "s/'/'\\\\''/g"; }
printf "node '%s' authorize --repo '%s' --branch '%s' --operations '%s'\n" "$(_q "$CLI")" "$(_q "$REPO")" "$(_q "$BRANCH")" "$(_q "$OPS")"
```

Show the printed line with the validated optional flags appended, each value
in single quotes, and ask the owner to
run it in a separate terminal on this machine. It prints the grant's terms
there and asks them to type a code. Then retry the refused command.
