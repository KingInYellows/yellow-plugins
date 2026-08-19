---
name: github-stack-setup
description: 'Check GitHub-native stacked-PR prerequisites — gh CLI, authentication, and the official github/gh-stack extension. Use when first installing the plugin, after gh auth changes, or when /stack:status reports PARTIAL_TOOLING for the github provider.'
user-invokable: false
---

## What It Does

Verifies that this machine can act as the `github` provider of the
`stacked-pr` capability group, and reports exactly what is missing. It
checks three things:

1. `gh` is installed and at least v2.0.
2. `gh auth status` succeeds.
3. The installed `gh stack` extension is the **official** `github/gh-stack`
   — verified by owner in `gh extension list`, not by the command
   resolving. Several third-party extensions expose the same `gh stack`
   command name.

It installs nothing on its own and runs no stack operation. Extension
installation is offered, never performed silently.

## When to Use

- First installing `github-workflow`.
- After changing `gh` authentication or reinstalling the GitHub CLI.
- When `/stack:status` reports `PARTIAL_TOOLING` for the `github` provider.

## Usage

### Step 1: Probe prerequisites

`plugins/yellow-core/lib/stack-tooling-probe.js` is the single owner of
this logic — do not re-derive `gh` presence, auth validity, or extension
identity here. Run this single Bash call and read its JSON output.

```bash
set -uo pipefail

PROBE="${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/stack-tooling-probe.js"
if [ ! -f "$PROBE" ]; then
  printf 'stack_provider_error: tooling probe not found at %s (is yellow-core installed?)\n' "$PROBE"
  exit 0
fi

node "$PROBE" probe --provider github
```

### Step 2: Report

Read the `github` object's `readiness` (`ready`/`not-ready`/`unknown`) and
`checks` (`present`, `version`, `authValid`, `extensionIdentity`:
`verified`/`wrong-owner`/`missing`/`unavailable`). Print each check, then
classify:

- **READY** — `readiness: "ready"` (requires `present`, `authValid`, and
  `extensionIdentity: "verified"` together).
- **NEEDS SETUP** — anything else.

Name the specific gap using `detail` and `checks.extensionIdentity`.
"Install the official extension with `gh extension install
github/gh-stack`" is useful; "prerequisites missing" is not.

If `extensionIdentity` is `wrong-owner`, say so explicitly: a third-party
`gh stack` will answer commands but is not the extension this provider
targets, and it must be removed before installing the official one.

If `readiness` is `unknown`, say so explicitly: the probe could not
determine readiness (a `gh auth status` or `gh extension list` failure,
not a "not installed" result) — treat it as unresolved, not as `NEEDS
SETUP`/`MISSING`.

### Step 3: Offer the install (never perform it silently)

Both offers below additionally require `checks.present: true` and
`checks.authValid: true` — an unauthenticated `gh` must never reach `gh
extension install`/`remove`. If either is false, report that gap and stop;
do not offer either flow, regardless of what `extensionIdentity` reports.

If `extensionIdentity` is `missing` and `gh` is present and authenticated,
use `AskUserQuestion` to offer:

- "Install github/gh-stack" — on confirmation, run
  `gh extension install github/gh-stack`, then re-run Step 1 and report.
- "Skip" — report the gap and stop.

If `extensionIdentity` is `wrong-owner` and `gh` is present and
authenticated, the official extension cannot be installed until the
third-party one is gone — use `AskUserQuestion` to offer the
remove-then-install flow instead:

- "Remove the third-party extension and install github/gh-stack" — on
  confirmation, run `gh extension remove stack` (the command name is
  shared, so this removes whichever extension currently provides it),
  then `gh extension install github/gh-stack`, then re-run Step 1 and
  report.
- "Skip" — report the gap and stop.

If `extensionIdentity` is `unavailable`, do not offer either flow — report
that the extension state could not be determined and stop.

Both install commands are deliberately unpinned. `--pin` is the right
call for a third-party extension, but `github/gh-stack` is first-party
(the Step 1 identity check exists to guarantee that) and is still in
active preview, so pinning would freeze every installer to a tag that
goes stale as GitHub ships fixes, in exchange for no reduction in trust
surface for someone already running `gh`. Revisit if gh-stack leaves
preview or ownership changes.

Do not offer to install `gh` itself, change authentication, or install the
`gh skill` package: `gh skill` is an explicitly preview surface ("subject to
change without notice") and nothing in this plugin depends on it.

### Step 4: Do not switch providers

This skill never enables or disables a plugin. If the user wants to make
`github` the active provider, direct them to `/stack:select github` — the
provider-neutral command in `yellow-core`. Say it plainly; do not run it.

## Boundaries

- Read-only apart from the confirmed `gh extension install`, and — for the
  `WRONG OWNER` replacement flow only — the confirmed `gh extension remove
  stack` that immediately precedes it. Both mutations require explicit
  `AskUserQuestion` confirmation; nothing else is mutated.
- Never invokes `gh stack init`, `add`, `submit`, `push`, `sync`, `rebase`,
  `modify`, `merge`, `link`, or `unstack`.
- Never touches `gt`, Graphite configuration, or `gt-workflow`.
- Never edits settings JSON, branch protections, rulesets, merge queues, or
  required checks.
