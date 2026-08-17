---
name: stack-provider-guard
description: 'Enforce the stacked-PR provider invariants before any provider-changing action — exactly one enabled, managed scopes fail closed, no direct settings edits, no silent fallback. Use when validating a proposed provider switch or auditing current provider state.'
user-invokable: false
---

## What It Does

Holds the line on the four invariants that make a single-provider model
actually single-provider. It is the check `/stack:select` runs before it
proposes anything, and the audit `/stack:status` runs before it declares a
state healthy.

**The invariants:**

1. **Exactly one enabled.** Both `gt-workflow` and `github-workflow` may be
   installed at once. At most one may be enabled. Two enabled is `CONFLICT`,
   not a preference to be resolved by ranking.
2. **Managed scope fails closed.** A plugin at `managed` scope is
   administrator-controlled and cannot be modified — `--plugin-dir` cannot
   override it either. When a switch would require changing a managed
   entry, refuse with `MANAGED_CONFLICT` and emit **no** commands. Never
   emit a `claude plugin disable` the CLI will reject.
3. **Never edit settings JSON directly.** `~/.claude/settings.json`,
   `.claude/settings.json`, and `.claude/settings.local.json` are off
   limits. Provider state changes go through
   `claude plugin install|enable|disable` and take effect via
   `/reload-plugins`.
4. **Never fall back.** If the intended provider cannot be made active, the
   result is a reported failure. Not the other provider. Not "the one that
   is installed". Not "the one whose CLI exists".

## When to Use

- Before presenting a provider switch plan to the user.
- After executing a switch, to confirm the end state is single-provider.
- When auditing why a stack workflow refused to run.

## Usage

### Step 1: Build the plan (never execute it here)

`plugins/yellow-core/lib/stack-provider-state.js` owns the preconditions.
Ask it for a plan rather than assembling `claude plugin` commands by hand —
the module is what the fixture tests cover.

```bash
set -uo pipefail

LIB="${CLAUDE_PLUGIN_ROOT}/lib/stack-provider-state.js"
if [ ! -f "$LIB" ]; then
  printf 'stack_provider_error: state library not found at %s\n' "$LIB"
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')

if ! plugin_json=$(claude plugin list --json 2>/dev/null); then
  printf 'stack_provider_error: `claude plugin list --json` failed — refusing to plan a switch\n'
  exit 0
fi

# TARGET_PROVIDER and TARGET_SCOPE are substituted by the calling command
# from validated user input (graphite|github and user|project|local).
printf '%s' "$plugin_json" | node "$LIB" plan \
  --plugins-file - \
  --target "$TARGET_PROVIDER" \
  --scope "$TARGET_SCOPE" \
  --project-path "$repo_root" \
  || printf 'stack_provider_error: planning failed — no commands were produced\n'
```

If the output contains a `stack_provider_error:` line, print that line and
stop. There is no plan, and a missing plan is not an empty one — do not
proceed to Step 2's refusal contract, which applies only to a `status:
"refused"` JSON result.

### Step 2: Enforce the refusal contract

A plan with `status: "refused"` carries `steps: []` — by construction, not
by convention. Never reconstruct a partial plan from a refusal:

| `reason` | What to say | What NOT to do |
| --- | --- | --- |
| `managed-conflict` | Name the managed plugin; the fix is with whoever controls managed settings | Do not emit any `claude plugin` command; do not suggest editing settings files |
| `unknown-provider` | List the known ids (`graphite`, `github`) | Do not guess the closest match |
| `invalid-scope` | List `user`, `project`, `local` | Do not silently fall back to `user` |

### Step 3: Enforce the confirmation contract

Any step with `requiresConfirmation: true` (installs) must be shown to the
user and approved before execution. Show the whole plan — every command,
in order — before running the first one. A user who approves a switch is
approving these exact commands.

### Step 4: Enforce the abort contract

If a step fails, stop. Do not run later steps, do not retry with a
different scope, and do not enable the other provider to "leave things
working". Report which step failed, which were completed, and which were
not run, then tell the user to re-run `/stack:status`. A half-applied
switch is a state the user must see, not one to be papered over.

### Step 5: Audit the end state

After a switch, re-classify (see `stack-provider-router`) and confirm the
state is `READY_GRAPHITE` or `READY_GITHUB` and matches the requested
target. If it is anything else, report it — including when the commands all
reported success, since `/reload-plugins` may not have run yet.

## Red flags this skill exists to catch

- A proposed command that writes to a settings JSON file.
- A `claude plugin disable` targeting a `managed`-scope entry.
- A plan that enables a provider without disabling the other one.
- Any sentence of the form "GitHub isn't ready, so using Graphite instead".
- Treating `claude plugin list --json` project/local rows from another
  repository as this repository's state (rows carry a `projectPath`).

## Boundaries

- Produces plans and verdicts. Executes nothing.
- Never writes `.yellow-stack.yml`; recording repository intent is the
  user's decision, made explicitly.
- Never uninstalls a provider. Disabling is reversible; uninstalling
  discards a user's install.
