---
name: stack:select
description: 'Select the active stacked-PR provider (graphite or github) at user, project, or local scope — shows the exact commands first, enables one provider, disables the other, and refuses managed-scope conflicts. Use when choosing or switching stacked-PR providers.'
argument-hint: '[graphite|github] [--scope user|project|local]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - Skill
---

# Select the Stacked-PR Provider

Make exactly one member of the `stacked-pr` capability group active:

- `graphite` → `gt-workflow`
- `github` → `github-workflow`

Both may stay installed. Only one may be enabled. This command shows every
command it intends to run before running any of them, and it refuses rather
than guessing.

**Arguments:** `$ARGUMENTS` — an optional provider id (`graphite` or
`github`) and an optional `--scope user|project|local` (default `user`).

## Step 0: Load the guard

Invoke the `Skill` tool with `skill: "stack-provider-guard"` and follow its
invariants for the rest of this command. They are the reason this command
exists; do not proceed from memory of them.

## Step 1: Parse and validate the request

Parse `$ARGUMENTS`:

- **Provider**: `graphite` or `github`. Anything else is invalid — do not
  fuzzy-match, do not pick the closest.
- **Scope**: `user`, `project`, or `local`. Default `user`. `managed` is
  not selectable: managed plugins are administrator-controlled.

If the provider is missing or invalid, run Step 2 first so the user sees the
current state, then use `AskUserQuestion` with the two provider options,
each labelled with what it would change. Do not proceed without an answer.

## Step 2: Show the current state

Run `/stack:status`'s classification and show the result before proposing
anything. A user cannot approve a switch they cannot see the starting point
of.

If the current state is already `READY_*` for the requested provider, say
so and stop — there is nothing to change.

## Step 3: Build the plan (nothing runs yet)

```bash
set -uo pipefail

LIB="${CLAUDE_PLUGIN_ROOT}/lib/stack-provider-state.js"
if [ ! -f "$LIB" ]; then
  printf 'stack_provider_error: state library not found at %s\n' "$LIB"
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')

# TARGET_PROVIDER / TARGET_SCOPE come from Step 1 and are already validated
# against the fixed sets {graphite,github} / {user,project,local}. Substitute
# the validated values here — never raw argument text.
if ! plugin_json=$(claude plugin list --json 2>/dev/null); then
  printf 'stack_provider_error: `claude plugin list --json` failed — refusing to plan a switch\n'
  exit 0
fi

printf '%s' "$plugin_json" | node "$LIB" plan \
  --plugins-file - \
  --target "$TARGET_PROVIDER" \
  --scope "$TARGET_SCOPE" \
  --project-path "$repo_root" \
  || printf 'stack_provider_error: planning failed — no commands were produced\n'
```

If the output contains a `stack_provider_error:` line, print that line and
stop. There is no plan — do not fall through to the example in Step 4 and
never execute a `claude plugin` command reconstructed from it.

### If the plan is refused

`status: "refused"` always comes with `steps: []`. Print the `reason` and
`detail`, then stop:

- `managed-conflict` — name the managed plugin. The only fix is a change to
  managed settings by whoever controls them. Do not emit any
  `claude plugin` command, and never suggest editing a settings file.
- `unknown-provider` — print the known ids and stop.
- `invalid-scope` — print `user`, `project`, `local` and stop.

Never reconstruct a partial plan from a refusal.

## Step 4: Show the exact proposed changes

Print every step, in order, before executing anything:

```text
Proposed provider switch: graphite → github (scope: user)

  1. Install github-workflow at user scope          [needs confirmation]
     claude plugin install github-workflow@yellow-plugins --scope user
  2. Enable github-workflow at user scope
     claude plugin enable github-workflow@yellow-plugins --scope user
  3. Disable gt-workflow at user scope
     claude plugin disable gt-workflow@yellow-plugins --scope user

  Then: /reload-plugins

  Nothing else is changed. Graphite stays installed; no settings file is
  edited; no branch, PR, or merge queue is touched.
```

Then use `AskUserQuestion`: "Apply this provider switch?" with options
"Apply", "Show what each step does", and "Cancel". If any step has
`requiresConfirmation: true` (installation pulls code onto the machine),
state that explicitly in the question — approval covers these exact
commands and no others.

On "Cancel", stop. Nothing has run.

## Step 5: Execute, in order, stopping at the first failure

Run each step's `command` exactly as printed, one per Bash call, in plan
order. After each, record success or failure.

If a step fails:

- Stop. Run no later step.
- Report which steps completed, which failed with its exit status, and
  which were **NOT RUN**.
- Do **not** retry at a different scope, do not enable the other provider
  to "leave things working", and do not roll back silently — an
  unexpected half-applied state is something the user must see.
- Tell the user to run `/stack:status` to see the resulting state.

## Step 6: Direct the user to /reload-plugins

`claude plugin` commands do not apply to the running session. After all
steps succeed, print:

> Provider switched. Run `/reload-plugins` to activate it in this session.
> If the reload warns that it would re-read the conversation, rerun it as
> `/reload-plugins --force`.

Do not claim the provider is active before that reload happens.

## Step 7: Offer to record repository intent

`.yellow-stack.yml` records which provider this **repository** intends to
use, so a mismatch with runtime state is detectable (`CONFIG_MISMATCH`):

```yaml
provider: github
```

Use `AskUserQuestion` to offer writing it: "Record `provider: <TARGET_PROVIDER>`
in `.yellow-stack.yml`?" with options "Write it" and "Skip". It is a
tracked file that affects every collaborator, so never write it without an
explicit yes, and never write it as a side effect of a switch.

On "Write it", write the file with Bash — the only mutation-capable tool
this command grants:

```bash
set -uo pipefail
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '.')
printf 'provider: %s\n' "$TARGET_PROVIDER" > "$repo_root/.yellow-stack.yml"
```

On "Skip", leave any existing file untouched and say so.

## Boundaries

- Never edits `~/.claude/settings.json`, `.claude/settings.json`, or
  `.claude/settings.local.json`.
- Never uninstalls a provider — disabling is reversible, uninstalling
  discards the user's install.
- Never enables both providers, and never leaves both enabled on purpose.
- Never falls back to the other provider for any reason.
- Never runs a stack operation (`gt` or `gh stack`); this command changes
  which provider is active and nothing else.
- Never touches branch protections, rulesets, merge queues, required
  checks, or any live PR.
