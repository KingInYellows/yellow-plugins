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

Run this single Bash call and read its output. It is read-only.

```bash
set -uo pipefail

printf '=== GitHub stacked-PR provider probe ===\n'

if command -v gh >/dev/null 2>&1; then
  gh_version=$(gh --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  printf 'gh:                 OK (%s)\n' "${gh_version:-unknown}"
  gh_major=${gh_version%%.*}
  case "$gh_major" in
    ''|*[!0-9]*) printf 'gh_version_gate:    UNKNOWN (could not parse version)\n' ;;
    *) if [ "$gh_major" -ge 2 ]; then
         printf 'gh_version_gate:    OK (>= 2.0)\n'
       else
         printf 'gh_version_gate:    TOO OLD (need >= 2.0)\n'
       fi ;;
  esac
else
  printf 'gh:                 MISSING\n'
  printf 'gh_version_gate:    SKIPPED (gh not found)\n'
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf 'gh_auth:            OK\n'
else
  printf 'gh_auth:            NOT AUTHENTICATED\n'
fi

# Identity check, not a name check: three third-party extensions also
# expose a `gh stack` command. Only github/gh-stack is first-party. Match
# a whole whitespace-delimited field, not a substring — a substring check
# would accept an owner like `notgithub/gh-stack` as official.
if command -v gh >/dev/null 2>&1; then
  ext_list=$(gh extension list 2>/dev/null || true)
  if printf '%s\n' "$ext_list" | awk '{ for (i=1;i<=NF;i++) if ($i == "github/gh-stack") found=1 } END { exit !found }'; then
    printf 'gh_stack_extension: OK (github/gh-stack)\n'
  elif printf '%s\n' "$ext_list" | awk '{ for (i=1;i<=NF;i++) if ($i ~ /^[^\/[:space:]]+\/gh-stack$/) found=1 } END { exit !found }'; then
    printf 'gh_stack_extension: WRONG OWNER (a non-github/gh-stack extension provides `gh stack`)\n'
  else
    printf 'gh_stack_extension: MISSING\n'
  fi
else
  printf 'gh_stack_extension: SKIPPED (gh not found)\n'
fi
```

### Step 2: Report

Print one line per check using the probe output verbatim. Then classify:

- **READY** — `gh` OK, `gh_version_gate` OK, `gh_auth` OK, and
  `gh_stack_extension` OK.
- **NEEDS SETUP** — anything else.

Name the specific gap. "Install the official extension with
`gh extension install github/gh-stack`" is useful; "prerequisites missing"
is not.

If `gh_stack_extension` reports `WRONG OWNER`, say so explicitly: a
third-party `gh stack` will answer commands but is not the extension this
provider targets, and it must be removed before installing the official
one.

### Step 3: Offer the install (never perform it silently)

If `gh_stack_extension` reports `MISSING` and `gh` is authenticated, use
`AskUserQuestion` to offer:

- "Install github/gh-stack" — on confirmation, run
  `gh extension install github/gh-stack`, then re-run Step 1 and report.
- "Skip" — report the gap and stop.

If `gh_stack_extension` reports `WRONG OWNER` and `gh` is authenticated,
the official extension cannot be installed until the third-party one is
gone — use `AskUserQuestion` to offer the remove-then-install flow
instead:

- "Remove the third-party extension and install github/gh-stack" — on
  confirmation, run `gh extension remove stack` (the command name is
  shared, so this removes whichever extension currently provides it),
  then `gh extension install github/gh-stack`, then re-run Step 1 and
  report.
- "Skip" — report the gap and stop.

Do not offer to install `gh` itself, change authentication, or install the
`gh skill` package: `gh skill` is an explicitly preview surface ("subject to
change without notice") and nothing in this plugin depends on it.

### Step 4: Do not switch providers

This skill never enables or disables a plugin. If the user wants to make
`github` the active provider, direct them to `/stack:select github` — the
provider-neutral command in `yellow-core`. Say it plainly; do not run it.

## Boundaries

- Read-only apart from the confirmed `gh extension install`.
- Never invokes `gh stack init`, `add`, `submit`, `push`, `sync`, `rebase`,
  `modify`, `merge`, `link`, or `unstack`.
- Never touches `gt`, Graphite configuration, or `gt-workflow`.
- Never edits settings JSON, branch protections, rulesets, merge queues, or
  required checks.
