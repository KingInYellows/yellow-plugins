---
name: stack-provider-router
description: 'Resolve which stacked-PR provider is active and route provider-specific work to it, or refuse when the state is ambiguous. Use when a workflow needs to know whether Graphite or GitHub native stacks is in effect before running a stack operation.'
user-invokable: false
---

## What It Does

Answers one question for other workflows: **which stacked-PR provider is
active right now, and is it safe to act on that answer?**

It resolves the answer from `plugins/yellow-core/lib/stack-provider-state.js`,
which classifies `claude plugin list --json` plus the repository's
`.yellow-stack.yml` intent into exactly one of seven states. The router
never re-derives a state from tooling presence, branch shape, or the
existence of a `.graphite.yml` — those are downstream symptoms, not the
provider decision.

Only two states route. The other five stop.

| State | Router behaviour |
| --- | --- |
| `READY_GRAPHITE` | Route to `gt-workflow` |
| `READY_GITHUB` | Route to `github-workflow` |
| `PARTIAL_TOOLING` | STOP — provider chosen, its CLI missing |
| `UNSELECTED` | STOP — no provider chosen |
| `CONFIG_MISMATCH` | STOP — runtime disagrees with `.yellow-stack.yml` |
| `CONFLICT` | STOP — both providers enabled |
| `MANAGED_CONFLICT` | STOP — administrator-controlled, unfixable locally |

**There is no fallback.** A stopped router does not "try Graphite anyway",
does not pick the installed provider, and does not pick the one whose CLI
happens to be present. Two stacked-PR providers acting on one repository is
a correctness failure, and guessing is how you get there.

## When to Use

- A workflow is about to run a stack operation (create, submit, sync,
  amend, merge) and must know which provider owns it.
- A command needs to name the active provider in its output.
- Before offering a provider-specific option in a prompt, so the offer
  matches reality.

## Usage

### Step 1: Resolve the state

Run this in a single Bash call. It is read-only.

```bash
set -uo pipefail

LIB="${CLAUDE_PLUGIN_ROOT}/lib/stack-provider-state.js"
if [ ! -f "$LIB" ]; then
  printf 'stack_provider_error: router library not found at %s\n' "$LIB"
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')
intent_file="${repo_root:-.}/.yellow-stack.yml"

# Provider CLI probes. Reported as explicit yes/no so the classifier can
# distinguish "checked and missing" (PARTIAL_TOOLING) from "never checked".
if command -v gt >/dev/null 2>&1; then tool_gt=yes; else tool_gt=no; fi
if command -v gh >/dev/null 2>&1 && gh extension list 2>/dev/null | grep -q 'github/gh-stack'; then
  tool_gh=yes
else
  tool_gh=no
fi

if ! plugin_json=$(claude plugin list --json 2>/dev/null); then
  printf 'stack_provider_error: `claude plugin list --json` failed — provider state is UNKNOWN\n'
  exit 0
fi

printf '%s' "$plugin_json" | node "$LIB" classify \
  --plugins-file - \
  --intent-file "$intent_file" \
  --project-path "$repo_root" \
  --tooling-graphite "$tool_gt" \
  --tooling-github "$tool_gh" \
  || printf 'stack_provider_error: classification failed — provider state is UNKNOWN\n'
```

### Step 2: Route or stop

Read `state` from the JSON.

**`READY_GRAPHITE`** — the active provider is `gt-workflow`. Dispatch
Graphite-owned work there (for example `/smart-submit`, `/gt-sync`,
`/gt-stack-plan`).

**`READY_GITHUB`** — the active provider is `github-workflow`. As of this
shell that plugin implements setup and status only, so a stack *operation*
has no destination yet. Say exactly that — "the GitHub provider is active
but stack operations are not implemented yet" — and stop. Do not silently
run the Graphite equivalent.

**Any other state** — stop and report. Print the `detail` field verbatim; it
already names the specific problem. Then give the one relevant next step:

- `UNSELECTED` → `/stack:select graphite` or `/stack:select github`
- `CONFIG_MISMATCH` → `/stack:status` for the mismatch, then `/stack:select`
- `CONFLICT` → `/stack:select <provider>` to disable the other
- `MANAGED_CONFLICT` → contact whoever controls managed settings; nothing
  local can fix it
- `PARTIAL_TOOLING` → the enabled provider's setup command (`/gt-setup` or
  `/github-stack:setup`)

### Step 3: Report the tooling caveat honestly

If `toolingKnown` is `false`, the tooling probe did not run for the enabled
provider. Say "provider CLI not checked" rather than implying a clean
result.

If `projectScopeFiltered` is `false`, `project`/`local` plugin rows could
not be filtered to this repository, so the state may reflect another
project's choice. Report that alongside the state.

## Boundaries

- Read-only. Never enables, disables, installs, or uninstalls a plugin —
  that is `/stack:select`'s job, behind confirmation.
- Never writes `.yellow-stack.yml`.
- Never substitutes one provider for the other under any condition.
- Never treats "one provider's CLI is installed" as evidence that provider
  is active.
