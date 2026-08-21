---
name: github-stack-status
description: 'Report GitHub-native stacked-PR tooling readiness and point to /stack:status (yellow-core) for the authoritative active-provider answer. Use when checking why gh stack tooling is unavailable or which stacked-PR provider is currently active.'
user-invokable: false
---

## What It Does

Read-only readiness report for the `github` provider of the `stacked-pr`
capability group. It answers two separate questions and never conflates
them:

1. **Is the tooling present?** (`gh`, authentication, the official
   `github/gh-stack` extension.)
2. **Is this provider the enabled one?** That question belongs to
   `yellow-core`'s `/stack:status`, which reads `claude plugin list --json`
   — this skill reports what that command says rather than guessing from
   the presence of `gh`.

Tooling being present does **not** mean this provider is active, and this
skill never implies otherwise.

## When to Use

- Diagnosing why GitHub stacked-PR tooling appears unavailable.
- Confirming which `stacked-pr` provider is currently enabled.
- Before asking for a provider switch, to see the starting state.

## Usage

### Step 1: Probe tooling

`plugins/yellow-core/lib/stack-tooling-probe.js` is the single owner of
this logic — do not re-derive `gh` presence, auth validity, or extension
identity here.

```bash
set -uo pipefail

PROBE="${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/stack-tooling-probe.js"
if [ ! -f "$PROBE" ]; then
  printf 'stack_provider_error: tooling probe not found at %s (is yellow-core installed?)\n' "$PROBE"
  exit 0
fi

node "$PROBE" probe --provider github
```

### Step 2: Ask who the active provider is

Report the enabled-provider question by pointing at the authoritative
surface rather than re-deriving it here:

> Active-provider state is owned by `/stack:status` (yellow-core), which
> reads `claude plugin list --json`.

If `yellow-core` is installed, tell the user to run `/stack:status` for the
authoritative answer, and include that instruction in the output. Do not
infer the active provider from tooling presence — a machine can have `gh`
and `gh-stack` installed while Graphite is the enabled provider, and
reporting that as "GitHub active" would be wrong.

### Step 3: Report

```text
GitHub stacked-PR provider
==========================

  gh                  OK (gh version 2.97.0 (2026-07-31))
  gh auth             OK
  github/gh-stack     MISSING

  Tooling:            NOT READY — install with `gh extension install github/gh-stack`
  Active provider:    run /stack:status (yellow-core) for the authoritative answer
```

Classify tooling from the probe's `readiness` field:

- **READY** — `readiness: "ready"` (present, authenticated, and
  `extensionIdentity: "verified"`).
- **NOT READY** — anything else, naming the specific gap from `detail` and
  `checks.extensionIdentity`. If `extensionIdentity` is `wrong-owner`, say
  a non-official `gh stack` extension is installed and must be removed
  before installing `github/gh-stack`.

If `readiness` is `unknown`, say so explicitly: the probe could not
determine readiness (a `gh auth status` or `gh extension list` failure,
not a "not installed" result) — report tooling as NOT READY for this
unresolved reason and stop; do not treat it as `MISSING`.

State the preview caveat once when tooling is READY: GitHub's native
stacked pull requests were in public preview as of 2026-08-17 and
merge-queue support was still rolling out.

## Boundaries

- Strictly read-only. No `gh stack` mutating subcommand, no plugin
  enable/disable, no settings edits.
- Never falls back to reporting Graphite state as if it were this
  provider's.
- Never claims this provider is active; that answer comes from
  `/stack:status`.
